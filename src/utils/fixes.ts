import type { Rule, Scope } from "eslint";
import { type AstNode, asAst, at, identName, list, str } from "./ast";
import { type Context, importOf } from "./scope";

/**
 * A text edit by range; rules combine several into one fix with {@link applyEdits}.
 *
 * @example
 * import type { Edit } from "@shadow-js/eslint-plugin/utils/fixes";
 *
 * // Inserts `()` after the identifier that ends at offset 12.
 * const call: Edit = { range: [12, 12], text: "()" };
 * @since 1.0.0
 */
export interface Edit {
  /** Start and end offsets of the replaced text (end exclusive; equal for an insertion). */
  range: [number, number];
  /** The replacement text (empty for a deletion). */
  text: string;
}

/**
 * Turns a list of edits into the fixer calls ESLint expects. Returned from a `fix` function, the
 * array is merged into one fix by ESLint, so the edits must not overlap.
 *
 * @param fixer The fixer ESLint passes to `fix`.
 * @param edits The edits, in any order.
 * @returns One `replaceTextRange` fix per edit.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { applyEdits, type Edit } from "@shadow-js/eslint-plugin/utils/fixes";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     DebuggerStatement(node: unknown): void {
 *       const statement = asAst(node);
 *       const edits: Edit[] = [{ range: statement.range, text: "" }];
 *       context.report({
 *         loc: statement.loc,
 *         message: "debugger statement",
 *         fix: (fixer) => applyEdits(fixer, edits),
 *       });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function applyEdits(fixer: Rule.RuleFixer, edits: readonly Edit[]): Rule.Fix[] {
  return edits.map((edit) => fixer.replaceTextRange(edit.range, edit.text));
}

function importDeclarations(context: Context): AstNode[] {
  const program = asAst(context.sourceCode.ast);
  return list(program, "body").filter((node) => node.type === "ImportDeclaration");
}

function programVariable(context: Context, name: string): Scope.Variable | undefined {
  const globalScope = context.sourceCode.scopeManager?.globalScope;
  if (globalScope === null || globalScope === undefined) return undefined;
  const moduleScope = globalScope.childScopes.find((scope) => scope.type === "module");
  return (moduleScope ?? globalScope).set.get(name);
}

type ImportPlan = { kind: "present" } | { kind: "extend"; edit: Edit } | { kind: "new" };

function planImport(
  context: Context,
  name: string,
  source: string,
  replaces: string | undefined,
): ImportPlan | null {
  const existing = programVariable(context, name);
  if (existing !== undefined) {
    const origin = importOf(existing);
    if (origin !== null && origin.source === source && origin.imported === name) {
      return { kind: "present" };
    }
    // The binding that is being moved away from `replaces` frees the name.
    const freed = origin !== null && replaces !== undefined && origin.source === replaces;
    if (existing.defs.length > 0 && !freed) return null;
  }
  for (const declaration of importDeclarations(context)) {
    const from = at(declaration, "source");
    const value = from === null ? undefined : Reflect.get(from, "value");
    if (value !== source || str(declaration, "importKind") === "type") continue;
    const specifiers = list(declaration, "specifiers");
    const named = specifiers.filter((specifier) => specifier.type === "ImportSpecifier");
    const last = named[named.length - 1];
    if (last !== undefined) {
      return { kind: "extend", edit: { range: [last.range[1], last.range[1]], text: `, ${name}` } };
    }
    const first = specifiers[0];
    if (first !== undefined && specifiers.every((s) => s.type === "ImportDefaultSpecifier")) {
      return {
        kind: "extend",
        edit: { range: [first.range[1], first.range[1]], text: `, { ${name} }` },
      };
    }
  }
  return { kind: "new" };
}

/**
 * Edits that make every wanted name importable from its module.
 *
 * - A name already imported under that name from that module adds nothing.
 * - Otherwise the first value import declaration of the module that has named specifiers (it gets
 *   `, name` after the last one) or only a default specifier (it gets `, { name }`) is extended.
 *   Type-only and namespace declarations are never extended.
 * - Otherwise one new `import { ... } from "module";` per module is added after the last import
 *   declaration, or before the first statement when the file has no import.
 *
 * @param context The rule context.
 * @param wanted The names to make available. Each entry has `name` (the exported name, also used as
 * the local name), `source` (the module specifier) and, optionally, `replaces` (a module whose
 * import of `name` the same fix removes, so that binding does not count as a conflict).
 * @returns The edits (empty when everything is imported already), or `null` when a name is already
 * declared at module level by anything but an import of that same name from `source` or an import
 * from `replaces`.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { applyEdits, ensureImports } from "@shadow-js/eslint-plugin/utils/fixes";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     JSXOpeningElement(node: unknown): void {
 *       const imports = ensureImports(context, [{ name: "Show", source: "@shadow-js/web" }]);
 *       if (imports === null) return;
 *       context.report({
 *         loc: asAst(node).loc,
 *         message: "Show is needed here",
 *         fix: (fixer) => applyEdits(fixer, imports),
 *       });
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link moveImportEdits}
 */
export function ensureImports(
  context: Context,
  wanted: ReadonlyArray<{ name: string; source: string; replaces?: string }>,
): Edit[] | null {
  const edits: Edit[] = [];
  const fresh = new Map<string, string[]>();
  for (const { name, source, replaces } of wanted) {
    const plan = planImport(context, name, source, replaces);
    if (plan === null) return null;
    if (plan.kind === "extend") edits.push(plan.edit);
    else if (plan.kind === "new") {
      const names = fresh.get(source) ?? [];
      if (!names.includes(name)) names.push(name);
      fresh.set(source, names);
    }
  }
  if (fresh.size > 0) {
    const lines = [...fresh].map(
      ([source, names]) => `import { ${names.join(", ")} } from "${source}";`,
    );
    const declarations = importDeclarations(context);
    const lastImport = declarations[declarations.length - 1];
    if (lastImport !== undefined) {
      edits.push({
        range: [lastImport.range[1], lastImport.range[1]],
        text: `\n${lines.join("\n")}`,
      });
    } else {
      const program = asAst(context.sourceCode.ast);
      const first = list(program, "body")[0];
      const position = first === undefined ? 0 : first.range[0];
      edits.push({ range: [position, position], text: `${lines.join("\n")}\n` });
    }
  }
  return edits;
}

/** TypeScript expressions whose operand is still evaluated: a read inside them is a value read. */
const VALUE_WRAPPERS: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/** True when an identifier under `parent` is erased with the types (`typeof count` in a type). */
function isTypeOnlyParent(parent: AstNode): boolean {
  return parent.type.startsWith("TS") && !VALUE_WRAPPERS.has(parent.type);
}

/**
 * Edits that turn every read of `variable` into a call (`count` becomes `count()`), including the
 * `{ count }` shorthand (`{ count: count() }`) and reads under `as`, `satisfies`, `!` and `<T>`.
 * The initializing reference and references in type positions (such as `typeof count` in a type)
 * are left alone.
 *
 * @param variable A variable from ESLint's scope manager.
 * @returns The edits, or `null` when the variable is written after its declaration or is
 * re-exported (`export { count }`), which cannot be rewritten mechanically.
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { applyEdits, readsToCalls } from "@shadow-js/eslint-plugin/utils/fixes";
 * import { type Context, resolveVariable } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     VariableDeclarator(node: unknown): void {
 *       const id = at(asAst(node), "id");
 *       const variable = id === null ? null : resolveVariable(context, id);
 *       const edits = variable === null ? null : readsToCalls(variable);
 *       if (id === null || edits === null) return;
 *       context.report({
 *         loc: id.loc,
 *         message: "read this value through a call",
 *         fix: (fixer) => applyEdits(fixer, edits),
 *       });
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link readsToPropertyAccess}
 */
export function readsToCalls(variable: Scope.Variable): Edit[] | null {
  const edits: Edit[] = [];
  for (const reference of variable.references) {
    if (reference.init === true) continue;
    if (reference.isWrite()) return null;
    const identifier = asAst(reference.identifier);
    const parent = identifier.parent;
    if (parent === null) return null;
    if (isTypeOnlyParent(parent)) continue;
    const name = identName(identifier);
    if (name === undefined) return null;
    if (parent.type === "Property" && Reflect.get(parent, "shorthand") === true) {
      edits.push({ range: parent.range, text: `${name}: ${name}()` });
    } else if (parent.type === "ExportSpecifier") {
      return null;
    } else {
      edits.push({ range: identifier.range, text: `${name}()` });
    }
  }
  return edits;
}

/**
 * Edits that replace every read of `variable` by `<object>.<key>`, including the `{ name }`
 * shorthand (`{ name: props.name }`) and reads under `as`, `satisfies`, `!` and `<T>`. The
 * initializing reference and references in type positions are left alone.
 *
 * @param variable A variable from ESLint's scope manager.
 * @param object The text of the object expression, such as `props`.
 * @param key The property name; a key that is not a valid identifier is written as
 * `<object>["key"]`.
 * @returns The edits, or `null` when the variable is written after its declaration or is
 * re-exported (`export { name }`).
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { applyEdits, readsToPropertyAccess } from "@shadow-js/eslint-plugin/utils/fixes";
 * import { type Context, resolveVariable } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     VariableDeclarator(node: unknown): void {
 *       const id = at(asAst(node), "id");
 *       const variable = id === null ? null : resolveVariable(context, id);
 *       const edits = variable === null ? null : readsToPropertyAccess(variable, "props", "title");
 *       if (id === null || edits === null) return;
 *       context.report({
 *         loc: id.loc,
 *         message: "read props.title directly",
 *         fix: (fixer) => applyEdits(fixer, edits),
 *       });
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link readsToCalls}
 */
export function readsToPropertyAccess(
  variable: Scope.Variable,
  object: string,
  key: string,
): Edit[] | null {
  const access = /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${object}.${key}`
    : `${object}[${JSON.stringify(key)}]`;
  const edits: Edit[] = [];
  for (const reference of variable.references) {
    if (reference.init === true) continue;
    if (reference.isWrite()) return null;
    const identifier = asAst(reference.identifier);
    const parent = identifier.parent;
    if (parent === null) return null;
    if (isTypeOnlyParent(parent)) continue;
    const name = identName(identifier);
    if (name === undefined) return null;
    if (parent.type === "Property" && Reflect.get(parent, "shorthand") === true) {
      edits.push({ range: parent.range, text: `${name}: ${access}` });
    } else if (parent.type === "ExportSpecifier") {
      return null;
    } else {
      edits.push({ range: identifier.range, text: access });
    }
  }
  return edits;
}

/**
 * The text of `range` with `edits` applied, for building a replacement that moves code elsewhere.
 *
 * Edits use absolute offsets into `text`. Only edits that lie entirely inside `range` are applied,
 * in order of their start; an edit that starts before the end of the previous applied edit is
 * skipped.
 *
 * @param text The whole source text.
 * @param range The slice of `text` to return (end exclusive).
 * @param edits The edits to apply inside the slice.
 * @returns The edited slice.
 * @example
 * import { sliceWithEdits } from "@shadow-js/eslint-plugin/utils/fixes";
 *
 * const source = "const view = rows.map((row) => row.name);";
 * // The callback `(row) => row.name` spans offsets 22 to 39; `row` is replaced by `row()`.
 * const callback: string = sliceWithEdits(source, [22, 39], [{ range: [31, 34], text: "row()" }]);
 * // "(row) => row().name"
 * @since 1.0.0
 */
export function sliceWithEdits(
  text: string,
  range: readonly [number, number],
  edits: readonly Edit[],
): string {
  const inside = edits
    .filter((edit) => edit.range[0] >= range[0] && edit.range[1] <= range[1])
    .sort((a, b) => a.range[0] - b.range[0]);
  let out = "";
  let position = range[0];
  for (const edit of inside) {
    if (edit.range[0] < position) continue;
    out += text.slice(position, edit.range[0]) + edit.text;
    position = edit.range[1];
  }
  return out + text.slice(position, range[1]);
}

/**
 * The edit that removes one specifier from its import declaration, keeping the rest valid:
 * `import React, { a, b } from "x"` loses `a` as `import React, { b } from "x"`, the last named
 * specifier with its braces (`import React from "x"`), or the default with its comma
 * (`import { a, b } from "x"`). When it is the only specifier the whole declaration goes, with
 * the newline that follows it.
 *
 * @param context The rule context (the source text is read from it).
 * @param specifier An import specifier (named, default or namespace).
 * @returns The edit, or `null` when the parent of `specifier` is not an `ImportDeclaration` or the
 * expected brace cannot be found in the text.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { applyEdits, removeSpecifierEdit } from "@shadow-js/eslint-plugin/utils/fixes";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     ImportDefaultSpecifier(node: unknown): void {
 *       const specifier = asAst(node);
 *       const edit = removeSpecifierEdit(context, specifier);
 *       if (edit === null) return;
 *       context.report({
 *         loc: specifier.loc,
 *         message: "default imports are not used",
 *         fix: (fixer) => applyEdits(fixer, [edit]),
 *       });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function removeSpecifierEdit(context: Context, specifier: AstNode): Edit | null {
  const declaration = specifier.parent;
  if (declaration === null || declaration.type !== "ImportDeclaration") return null;
  const specifiers = list(declaration, "specifiers");
  const text = context.sourceCode.text;
  if (specifiers.length === 1) {
    let end = declaration.range[1];
    if (text[end] === "\n") end += 1;
    return { range: [declaration.range[0], end], text: "" };
  }
  const named = specifiers.filter((candidate) => candidate.type === "ImportSpecifier");
  const others = specifiers.filter((candidate) => candidate.type !== "ImportSpecifier");
  if (specifier.type === "ImportSpecifier") {
    if (named.length === 1) {
      // `import React, { a } from "x"` keeps `React`.
      const lastOther = others[others.length - 1];
      const close = text.indexOf("}", specifier.range[1]);
      if (lastOther === undefined || close === -1) return null;
      return { range: [lastOther.range[1], close + 1], text: "" };
    }
    const index = named.indexOf(specifier);
    const next = named[index + 1];
    if (next !== undefined) return { range: [specifier.range[0], next.range[0]], text: "" };
    const previous = named[index - 1];
    return previous === undefined
      ? null
      : { range: [previous.range[1], specifier.range[1]], text: "" };
  }
  // A default or namespace specifier.
  if (named.length > 0) {
    const brace = text.indexOf("{", specifier.range[1]);
    return brace === -1 ? null : { range: [specifier.range[0], brace], text: "" };
  }
  const index = specifiers.indexOf(specifier);
  const next = specifiers[index + 1];
  if (next !== undefined) return { range: [specifier.range[0], next.range[0]], text: "" };
  const previous = specifiers[index - 1];
  return previous === undefined
    ? null
    : { range: [previous.range[1], specifier.range[1]], text: "" };
}

/**
 * Edits that move one named import to another module: the specifier leaves its declaration (see
 * {@link removeSpecifierEdit}) and the name is imported from `target` (see {@link ensureImports},
 * with `replaces` set to `source`). When the removed declaration is where the new import would be
 * inserted, the new import replaces it in place (the two edits would otherwise overlap).
 *
 * @param context The rule context.
 * @param specifier The import specifier to move.
 * @param name The exported name to import from `target`.
 * @param target The module specifier the name moves to.
 * @param source The module specifier the name currently comes from.
 * @returns The edits, the removal first, or `null` when either the removal or the import cannot be
 * made safely.
 * @example
 * import { asAst, at, identName } from "@shadow-js/eslint-plugin/utils/ast";
 * import { applyEdits, moveImportEdits } from "@shadow-js/eslint-plugin/utils/fixes";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     ImportSpecifier(node: unknown): void {
 *       const specifier = asAst(node);
 *       const declaration = specifier.parent;
 *       const from = declaration === null ? null : at(declaration, "source");
 *       const name = identName(at(specifier, "imported"));
 *       if (from === null || Reflect.get(from, "value") !== "solid-js" || name !== "Show") return;
 *       const edits = moveImportEdits(context, specifier, name, "@shadow-js/web", "solid-js");
 *       if (edits === null) return;
 *       context.report({
 *         loc: specifier.loc,
 *         message: "import Show from @shadow-js/web",
 *         fix: (fixer) => applyEdits(fixer, edits),
 *       });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function moveImportEdits(
  context: Context,
  specifier: AstNode,
  name: string,
  target: string,
  source: string,
): Edit[] | null {
  const removal = removeSpecifierEdit(context, specifier);
  const added = ensureImports(context, [{ name, source: target, replaces: source }]);
  if (removal === null || added === null) return null;
  const out: Edit[] = [];
  let removalEdit = removal;
  for (const edit of added) {
    const touches = edit.range[0] >= removalEdit.range[0] && edit.range[0] <= removalEdit.range[1];
    if (touches && edit.range[0] === edit.range[1]) {
      const keepsNewline = removalEdit.range[1] > (specifier.parent?.range[1] ?? 0);
      removalEdit = {
        range: removalEdit.range,
        text: edit.text.replace(/^\n/, "") + (keepsNewline ? "\n" : ""),
      };
    } else {
      out.push(edit);
    }
  }
  return [removalEdit, ...out];
}
