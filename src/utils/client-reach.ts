import { type AstNode, asAst, at, isFunction, list, str, unwrap, walk } from "./ast";
import { type Context, importOf, resolveVariable } from "./scope";

/** The module whose `serverFn` the Dusk build recognizes (see `server-fn.ts` in `@shadow-js/dusk`). */
const DUSK_SERVER = "@shadow-js/dusk/server";
const DIRECTIVE = "use server";

/** Syntax that only exists in types: a reference inside it is erased with the types. */
const TYPE_CONTEXTS: ReadonlySet<string> = new Set([
  "TSTypeAnnotation",
  "TSTypeQuery",
  "TSTypeReference",
  "TSTypeParameterInstantiation",
  "TSTypeParameterDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSImportType",
]);

/** Declarations at the top of a module that exist only for the type checker. */
const TYPE_DECLARATIONS: ReadonlySet<string> = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
]);

/** Top-level statements that declare names and keep nothing alive by themselves. */
const PLAIN_DECLARATIONS: ReadonlySet<string> = new Set([
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
]);

/**
 * What the client build keeps of a module, as far as one file can tell; built by
 * {@link analyzeClientReach}.
 *
 * @example
 * import type { ClientReach } from "@shadow-js/eslint-plugin/utils/client-reach";
 * import type { AstNode } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function reachesBrowser(reach: ClientReach, importDeclaration: AstNode): boolean {
 *   return reach.importSurvives(importDeclaration);
 * }
 * @since 1.0.0
 */
export interface ClientReach {
  /** True when the module defines server functions (`serverFn(...)` or `"use server"` functions). */
  readonly hasServerFunctions: boolean;
  /** True when `node` is inside code the client build replaces by a stub. */
  isStripped(node: AstNode): boolean;
  /** True when the imports of this declaration are still in the module the browser loads. */
  importSurvives(declaration: AstNode): boolean;
  /** True when the code at `node` is still in the module the browser loads. */
  survives(node: AstNode): boolean;
}

/** The exports the router lazy-loads as the UI half of a route (`splitRouteModule`). */
const UI_EXPORTS: ReadonlySet<string> = new Set(["default", "pending", "error", "notFound"]);

/** Names a top-level export statement exports. */
function exportedNames(statement: AstNode): string[] {
  if (statement.type === "ExportDefaultDeclaration") return ["default"];
  if (statement.type !== "ExportNamedDeclaration") return [];
  const declaration = at(statement, "declaration");
  if (declaration === null) {
    return list(statement, "specifiers").flatMap((specifier) => {
      const exported = at(specifier, "exported");
      const name =
        exported === null ? undefined : (str(exported, "name") ?? str(exported, "value"));
      return name === undefined ? [] : [name];
    });
  }
  if (declaration.type === "VariableDeclaration") {
    return list(declaration, "declarations").flatMap((declarator) => {
      const id = at(declarator, "id");
      const name = id === null ? undefined : str(id, "name");
      return name === undefined ? [] : [name];
    });
  }
  const id = at(declaration, "id");
  const name = id === null ? undefined : str(id, "name");
  return name === undefined ? [] : [name];
}

/**
 * True when the router splits this module in two (`splitRouteModule`): it exports part of the UI
 * (`default`, `pending`, `error`, `notFound`), has no `export *` and no top-level statements that run
 * code. The router keeps in each half only what that half's exports use. (A declaration that both
 * halves use also stops the split; one file's view of that is not modeled, so such a module is
 * treated as split and its unused imports go unreported.)
 *
 * Allowed top-level statements are imports, exports, variable, function and class declarations,
 * empty statements, directives (`"use client"`) and TypeScript-only statements.
 *
 * @param program The `Program` node of the file.
 * @returns `true` when the module exports a UI name and every top-level statement is allowed.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { isSplitRouteModule } from "@shadow-js/eslint-plugin/utils/client-reach";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     Program(node: unknown): void {
 *       const program = asAst(node);
 *       if (context.filename.includes("/routes/") && !isSplitRouteModule(program)) {
 *         context.report({ loc: program.loc, message: "this route module is not split" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function isSplitRouteModule(program: AstNode): boolean {
  const body = list(program, "body");
  if (!body.some((statement) => exportedNames(statement).some((name) => UI_EXPORTS.has(name)))) {
    return false;
  }
  return body.every((statement) => {
    switch (statement.type) {
      case "ExportAllDeclaration":
        return false;
      case "ExpressionStatement":
        return str(statement, "directive") !== undefined;
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "VariableDeclaration":
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "EmptyStatement":
        return true;
      default:
        return statement.type.startsWith("TS");
    }
  });
}

/**
 * True when the directive prologue of a body (its leading directive statements) includes
 * `"use server"`. The scan stops at the first statement that is not a directive.
 *
 * @param body The statements of a `Program` or of a function's `BlockStatement`.
 * @returns `true` when a leading directive is `use server`.
 * @example
 * import { asAst, list } from "@shadow-js/eslint-plugin/utils/ast";
 * import { hasUseServerDirective } from "@shadow-js/eslint-plugin/utils/client-reach";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     Program(node: unknown): void {
 *       const program = asAst(node);
 *       if (hasUseServerDirective(list(program, "body"))) {
 *         context.report({ loc: program.loc, message: "a server module" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function hasUseServerDirective(body: readonly AstNode[]): boolean {
  for (const statement of body) {
    const directive = str(statement, "directive");
    if (directive === undefined) return false;
    if (directive === DIRECTIVE) return true;
  }
  return false;
}

function isUseServerFunction(node: AstNode): boolean {
  if (!isFunction(node)) return false;
  const body = at(node, "body");
  return (
    body !== null && body.type === "BlockStatement" && hasUseServerDirective(list(body, "body"))
  );
}

/** True for `serverFn(...)` where `serverFn` comes from `@shadow-js/dusk/server`. */
function isServerFnCall(context: Context, node: AstNode): boolean {
  if (node.type !== "CallExpression") return false;
  const calleeNode = at(node, "callee");
  if (calleeNode === null) return false;
  const callee = unwrap(calleeNode);
  if (callee.type === "Identifier") {
    const variable = resolveVariable(context, callee);
    const origin = variable === null ? null : importOf(variable);
    return origin !== null && origin.source === DUSK_SERVER && origin.imported === "serverFn";
  }
  if (callee.type === "MemberExpression" && Reflect.get(callee, "computed") !== true) {
    const object = at(callee, "object");
    const property = at(callee, "property");
    if (object === null || property === null || object.type !== "Identifier") return false;
    if (str(property, "name") !== "serverFn") return false;
    const variable = resolveVariable(context, object);
    const origin = variable === null ? null : importOf(variable);
    return origin !== null && origin.source === DUSK_SERVER && origin.imported === "*";
  }
  return false;
}

/** One piece of a module that the build keeps or drops on its own (see `collectUnits` in the router). */
interface Unit {
  readonly root: boolean;
  /** Units this one reads, everywhere in its code. */
  readonly reads: Set<Unit>;
  /** Units this one reads outside stripped code. */
  readonly keeps: Set<Unit>;
}

/** The child of `parent` that contains `node`. */
function childContaining(parent: AstNode, node: AstNode): AstNode | null {
  let current: AstNode | null = node;
  while (current !== null && current.parent !== parent) current = current.parent;
  return current;
}

function reachable(roots: Iterable<Unit>, edges: (unit: Unit) => Set<Unit>): Set<Unit> {
  const seen = new Set<Unit>();
  const pending = [...roots];
  while (pending.length > 0) {
    const unit = pending.pop();
    if (unit === undefined || seen.has(unit)) continue;
    seen.add(unit);
    for (const next of edges(unit)) pending.push(next);
  }
  return seen;
}

/**
 * Works out, for one module, which code the Dusk client build replaces by stubs (the arguments of
 * `serverFn(...)` and the bodies of `"use server"` functions) and which imports that leaves
 * behind. It mirrors the build: the server-function transform replaces that code, then removes the
 * declarations and imports that only the replaced code used (`pruneModule` in
 * `@shadow-js/router/vite`). A module with no server function is not rewritten at all, so every
 * import it has counts. A route module is different: the router splits it into a data half and a UI
 * half and keeps only what the route's exports use, so code and imports that nothing uses are gone
 * (`routeModule`, see {@link isSplitRouteModule}).
 *
 * @param context The rule context (scope analysis is read from it).
 * @param routeModule True for a file the router splits (a page under `routes/`); default `false`.
 * @returns The queries a rule asks. All answers are `true`/`false` for "still in the browser". For a
 * module that is neither a route module nor has server functions, `importSurvives` and `survives`
 * always answer `true`.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { analyzeClientReach } from "@shadow-js/eslint-plugin/utils/client-reach";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   const reach = analyzeClientReach(context, context.filename.includes("/routes/"));
 *   return {
 *     ImportDeclaration(node: unknown): void {
 *       const declaration = asAst(node);
 *       if (reach.importSurvives(declaration)) {
 *         context.report({ loc: declaration.loc, message: "this import reaches the browser" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link isSplitRouteModule}
 */
export function analyzeClientReach(context: Context, routeModule = false): ClientReach {
  const program = asAst(context.sourceCode.ast);
  const stripped = new Set<AstNode>();
  walk(program, context.sourceCode.visitorKeys, (node) => {
    if (isServerFnCall(context, node) || isUseServerFunction(node)) {
      stripped.add(node);
      return false;
    }
    return true;
  });
  const isStripped = (node: AstNode): boolean => {
    for (let current: AstNode | null = node; current !== null; current = current.parent) {
      if (stripped.has(current)) return true;
    }
    return false;
  };
  const hasServerFunctions = stripped.size > 0;
  if (!hasServerFunctions && !routeModule) {
    return {
      hasServerFunctions,
      isStripped,
      importSurvives: () => true,
      survives: () => true,
    };
  }

  const units = new Map<AstNode, Unit>();
  const add = (key: AstNode, root: boolean): void => {
    units.set(key, { root, reads: new Set(), keeps: new Set() });
  };
  const body = list(program, "body");
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") {
      if (str(statement, "importKind") === "type") continue;
      const specifiers = list(statement, "specifiers");
      if (specifiers.length === 0) add(statement, true);
      for (const specifier of specifiers) {
        if (str(specifier, "importKind") !== "type") add(specifier, false);
      }
      continue;
    }
    if (TYPE_DECLARATIONS.has(statement.type)) continue;
    const exported = statement.type === "ExportNamedDeclaration";
    const declaration = exported ? at(statement, "declaration") : statement;
    if (exported && str(statement, "exportKind") === "type") continue;
    if (declaration === null) {
      add(statement, true);
      continue;
    }
    if (TYPE_DECLARATIONS.has(declaration.type) || Reflect.get(declaration, "declare") === true) {
      continue;
    }
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of list(declaration, "declarations")) add(declarator, exported);
    } else if (PLAIN_DECLARATIONS.has(declaration.type)) {
      add(declaration, exported);
    } else {
      add(statement, true);
    }
  }

  /** The unit that holds `node`, or `undefined` for type-only code and for nodes outside a unit. */
  const unitOf = (node: AstNode): Unit | undefined => {
    const statement = childContaining(program, node);
    if (statement === null) return undefined;
    if (statement.type === "ImportDeclaration") {
      const specifier = childContaining(statement, node);
      return units.get(specifier !== null && units.has(specifier) ? specifier : statement);
    }
    const declaration =
      statement.type === "ExportNamedDeclaration" ? at(statement, "declaration") : statement;
    if (declaration !== null && declaration.type === "VariableDeclaration") {
      const declarator = childContaining(declaration, node);
      return declarator === null ? undefined : units.get(declarator);
    }
    if (declaration !== null && units.has(declaration)) return units.get(declaration);
    return units.get(statement);
  };

  const inTypePosition = (node: AstNode): boolean => {
    for (let current: AstNode | null = node.parent; current !== null; current = current.parent) {
      if (TYPE_CONTEXTS.has(current.type)) return true;
      if (current === program) return false;
    }
    return false;
  };

  for (const scope of context.sourceCode.scopeManager.scopes) {
    if ((scope.block as unknown) !== program) continue;
    for (const variable of scope.variables) {
      const targets: Unit[] = [];
      for (const definition of variable.defs) {
        const target = unitOf(asAst(definition.node));
        if (target !== undefined) targets.push(target);
      }
      if (targets.length === 0) continue;
      for (const reference of variable.references) {
        // typescript-eslint tells value references from type references; eslint-scope has no types.
        if (Reflect.get(reference, "isValueReference") === false) continue;
        const identifier = asAst(reference.identifier);
        if (inTypePosition(identifier)) continue;
        const from = unitOf(identifier);
        if (from === undefined) continue;
        const inStripped = isStripped(identifier);
        for (const target of targets) {
          from.reads.add(target);
          if (!inStripped) from.keeps.add(target);
        }
      }
    }
  }

  const all = [...units.values()];
  const aliveBefore = reachable(
    all.filter((unit) => unit.root),
    (unit) => unit.reads,
  );
  // The server-function transform leaves alone what nothing read before; only what the stripped
  // code kept alive goes. The route split keeps just what the exports use.
  const aliveAfter = reachable(
    all.filter((unit) => unit.root || (!routeModule && !aliveBefore.has(unit))),
    (unit) => unit.keeps,
  );

  return {
    hasServerFunctions,
    isStripped,
    importSurvives(declaration) {
      if (str(declaration, "importKind") === "type") return false;
      const specifiers = list(declaration, "specifiers");
      if (specifiers.length === 0) return true;
      return specifiers.some((specifier) => {
        const unit = units.get(specifier);
        return unit !== undefined && aliveAfter.has(unit);
      });
    },
    survives(node) {
      if (isStripped(node)) return false;
      const unit = unitOf(node);
      return unit !== undefined && aliveAfter.has(unit);
    },
  };
}
