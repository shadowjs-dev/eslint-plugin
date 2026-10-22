import type { Scope, SourceCode } from "eslint";
import {
  type AstNode,
  asAst,
  at,
  identName,
  isFunction,
  list,
  slots,
  str,
  unwrap,
  walk,
} from "./ast";
import { isComponent } from "./components";
import { type Context, resolveVariable, shadowApiName } from "./scope";

/**
 * What kind of reactive read function a variable holds, by the API that created it: `useSignal`
 * (and `useStore` of a single value) give `signal`, `useMemo` gives `memo`, `useResource` gives
 * `resource`, `useSelector` gives `selector` and `children` gives `children`.
 *
 * @example
 * import type { AccessorKind } from "@shadow-js/eslint-plugin/utils/reactive";
 *
 * export function hasMembers(kind: AccessorKind): boolean {
 *   return kind === "resource" || kind === "children";
 * }
 * @since 1.0.0
 * @see {@link ACCESSOR_MEMBERS}
 */
export type AccessorKind = "signal" | "memo" | "resource" | "selector" | "children";

/**
 * What a tracked setter writes to: a signal (`useSignal`, or `useStore` of a single value) or a deep
 * store (`useStore` of an object or array literal).
 *
 * @example
 * import type { SetterKind } from "@shadow-js/eslint-plugin/utils/reactive";
 *
 * const kind: SetterKind = "store";
 * @since 1.0.0
 */
export type SetterKind = "signal" | "store";

/**
 * Variables of one file that hold reactive accessors and setters, found from how they were declared
 * (`const [count, setCount] = useSignal(0)`, `const total = useMemo(...)`, aliases of those).
 *
 * @example
 * import type { ReactiveModel } from "@shadow-js/eslint-plugin/utils/reactive";
 *
 * export function trackedCount(model: ReactiveModel): number {
 *   return model.accessors.size + model.setters.size + model.stores.size;
 * }
 * @since 1.0.0
 * @see {@link reactiveModel}
 */
export interface ReactiveModel {
  /** Variables that hold an accessor (called to read), with the kind of accessor. */
  readonly accessors: ReadonlyMap<Scope.Variable, AccessorKind>;
  /** Variables that hold a tracked setter, with what it writes to. */
  readonly setters: ReadonlyMap<Scope.Variable, SetterKind>;
  /** Variables that hold a store view (`const [state] = useStore(...)`): read by property, never called. */
  readonly stores: ReadonlySet<Scope.Variable>;
}

const cache = new WeakMap<SourceCode, ReactiveModel>();

/**
 * Members an accessor exposes besides being callable, per {@link AccessorKind}: a resource's
 * `state`, `loading`, `error`, `latest`, `refetch` and `mutate`, and `toArray` of `children`.
 * Reading one of these is not a missing call.
 *
 * @example
 * import { ACCESSOR_MEMBERS } from "@shadow-js/eslint-plugin/utils/reactive";
 *
 * const allowed: boolean = ACCESSOR_MEMBERS.resource.has("loading"); // true
 * const missingCall: boolean = !ACCESSOR_MEMBERS.signal.has("length"); // true
 * @since 1.0.0
 */
export const ACCESSOR_MEMBERS: Readonly<Record<AccessorKind, ReadonlySet<string>>> = {
  signal: new Set(),
  memo: new Set(),
  selector: new Set(),
  resource: new Set(["state", "loading", "error", "latest", "refetch", "mutate"]),
  children: new Set(["toArray"]),
};

const OPAQUE_CONSTRUCTORS = new Set([
  "Date",
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
]);

/**
 * How `useStore` treats an initial value: a single-value cell (`opaque`), a deep store (`plain`) or
 * not decidable without types (`unknown`). Wrappers are removed first (see `unwrap`).
 *
 * - `opaque`: literals (including `null`), template literals, functions, a unary operator applied to
 *   a literal (`-1`), `undefined`, and `new` of `Date`, `RegExp`, `Map`, `Set`, `WeakMap`,
 *   `WeakSet` or `Promise`.
 * - `plain`: object and array literals.
 * - `unknown`: everything else, and a missing argument.
 *
 * @param initial The first argument of `useStore(...)`, or `null` when there is none.
 * @returns `"opaque"`, `"plain"` or `"unknown"`.
 * @example
 * import { asAst, list } from "@shadow-js/eslint-plugin/utils/ast";
 * import { storeShape } from "@shadow-js/eslint-plugin/utils/reactive";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const call = asAst(node);
 *       if (storeShape(list(call, "arguments")[0] ?? null) === "plain") {
 *         context.report({ loc: call.loc, message: "a deep store" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function storeShape(initial: AstNode | null): "opaque" | "plain" | "unknown" {
  if (initial === null) return "unknown";
  const node = unwrap(initial);
  switch (node.type) {
    case "Literal":
    case "TemplateLiteral":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return "opaque";
    case "UnaryExpression": {
      const argument = at(node, "argument");
      return argument !== null && argument.type === "Literal" ? "opaque" : "unknown";
    }
    case "Identifier":
      return str(node, "name") === "undefined" ? "opaque" : "unknown";
    case "NewExpression": {
      const name = identName(at(node, "callee"));
      return name !== undefined && OPAQUE_CONSTRUCTORS.has(name) ? "opaque" : "unknown";
    }
    case "ObjectExpression":
    case "ArrayExpression":
      return "plain";
    default:
      return "unknown";
  }
}

function variableOfDeclared(
  id: AstNode | null,
  scopes: readonly Scope.Scope[],
): Scope.Variable | null {
  if (id === null || id.type !== "Identifier") return null;
  for (const scope of scopes) {
    for (const variable of scope.variables) {
      if (variable.identifiers.some((identifier) => (identifier as unknown) === id))
        return variable;
    }
  }
  return null;
}

/**
 * Builds (once per file, cached by `SourceCode`) the map of reactive accessors and setters.
 * Declarations are read from the scope manager so hoisting and closures that appear before the
 * declaration are covered.
 *
 * Recognized declarations (the API is resolved with `shadowApiName`):
 * - `const [a, setA] = useSignal(...)`: `a` is a `signal` accessor, `setA` a `signal` setter.
 * - `const [s, setS] = useStore(init)`: by {@link storeShape} of `init`, `s` is a `signal` accessor
 *   (`opaque`), a store view (`plain`) or neither (`unknown`), and `setS` a `signal` setter
 *   (`opaque`) or a `store` setter (any other shape).
 * - `const x = useMemo(...)`, `useResource(...)`, `useSelector(...)`, `children(...)`: accessors.
 * - `const b = a`: an alias takes the role of `a` (followed through up to four passes).
 *
 * @param context The rule context.
 * @returns The model for the file being linted.
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { reactiveModel } from "@shadow-js/eslint-plugin/utils/reactive";
 * import { type Context, resolveVariable } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   const model = reactiveModel(context);
 *   return {
 *     UnaryExpression(node: unknown): void {
 *       const argument = at(asAst(node), "argument");
 *       const variable = argument === null ? null : resolveVariable(context, argument);
 *       if (argument !== null && variable !== null && model.accessors.has(variable)) {
 *         context.report({ loc: argument.loc, message: "an accessor is always truthy" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link readsReactive}
 */
export function reactiveModel(context: Context): ReactiveModel {
  const sourceCode = context.sourceCode;
  const cached = cache.get(sourceCode);
  if (cached !== undefined) return cached;
  const accessors = new Map<Scope.Variable, AccessorKind>();
  const setters = new Map<Scope.Variable, SetterKind>();
  const stores = new Set<Scope.Variable>();
  const scopes = sourceCode.scopeManager?.scopes ?? [];
  const aliases: Array<{ variable: Scope.Variable; target: Scope.Variable }> = [];

  for (const scope of scopes) {
    for (const variable of scope.variables) {
      for (const def of variable.defs) {
        if (def.type !== "Variable") continue;
        const declarator = asAst(def.node);
        if (declarator.type !== "VariableDeclarator") continue;
        const id = at(declarator, "id");
        const initNode = at(declarator, "init");
        if (id === null || initNode === null) continue;
        const init = unwrap(initNode);
        if (id.type === "Identifier") {
          if (init.type === "Identifier") {
            const target = resolveVariable(context, init);
            if (target !== null) aliases.push({ variable, target });
            continue;
          }
          if (init.type !== "CallExpression") continue;
          const callee = at(init, "callee");
          const api = callee === null ? null : shadowApiName(context, callee);
          if (api === "useMemo") accessors.set(variable, "memo");
          else if (api === "useResource") accessors.set(variable, "resource");
          else if (api === "useSelector") accessors.set(variable, "selector");
          else if (api === "children") accessors.set(variable, "children");
          continue;
        }
        if (id.type !== "ArrayPattern" || init.type !== "CallExpression") continue;
        const callee = at(init, "callee");
        const api = callee === null ? null : shadowApiName(context, callee);
        if (api !== "useSignal" && api !== "useStore") continue;
        const [first, second] = slots(id, "elements");
        const firstVariable = variableOfDeclared(first ?? null, [scope]);
        const secondVariable = variableOfDeclared(second ?? null, [scope]);
        if (api === "useSignal") {
          if (firstVariable === variable) accessors.set(variable, "signal");
          if (secondVariable === variable) setters.set(variable, "signal");
        } else {
          // `useStore(0)` is a single-value cell (an accessor); `useStore({ ... })` is a deep store.
          const shape = storeShape(list(init, "arguments")[0] ?? null);
          if (firstVariable === variable) {
            if (shape === "opaque") accessors.set(variable, "signal");
            else if (shape === "plain") stores.add(variable);
          }
          if (secondVariable === variable)
            setters.set(variable, shape === "opaque" ? "signal" : "store");
        }
      }
    }
  }
  // `const c = count; const d = c;` — aliases follow their target (bounded passes, no cycles possible
  // in valid `const` chains, but a loop guard keeps malformed input cheap).
  for (let pass = 0; pass < 4; pass += 1) {
    let grew = false;
    for (const { variable, target } of aliases) {
      const accessor = accessors.get(target);
      if (accessor !== undefined && !accessors.has(variable)) {
        accessors.set(variable, accessor);
        grew = true;
      }
      const setter = setters.get(target);
      if (setter !== undefined && !setters.has(variable)) {
        setters.set(variable, setter);
        grew = true;
      }
      if (stores.has(target) && !stores.has(variable)) {
        stores.add(variable);
        grew = true;
      }
    }
    if (!grew) break;
  }
  const model: ReactiveModel = { accessors, setters, stores };
  cache.set(sourceCode, model);
  return model;
}

/**
 * The name of the property a member expression reads: `object.property`, `object?.property`, or a
 * computed access with a string literal (`object["property"]`).
 *
 * @param member The node to read; anything other than a `MemberExpression` gives `undefined`.
 * @returns The property name, or `undefined` for other node types, for computed accesses with
 * anything but a string literal, and for private names.
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { memberName } from "@shadow-js/eslint-plugin/utils/reactive";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const callee = at(asAst(node), "callee");
 *       if (callee !== null && memberName(callee) === "forEach") {
 *         context.report({ loc: callee.loc, message: "forEach call" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function memberName(member: AstNode): string | undefined {
  if (member.type !== "MemberExpression") return undefined;
  if (Reflect.get(member, "computed") === true) {
    const property = at(member, "property");
    const value = property === null ? undefined : Reflect.get(property, "value");
    return typeof value === "string" ? value : undefined;
  }
  return identName(at(member, "property"));
}

/**
 * A call that writes a signal or store, found from the setter variables or `writeSignal`, as
 * {@link writeCallOf} reports it.
 *
 * @example
 * import type { WriteCall } from "@shadow-js/eslint-plugin/utils/reactive";
 *
 * export function describeWrite(write: WriteCall): string {
 *   return write.setter === null ? `${write.name} (untracked)` : write.name;
 * }
 * @since 1.0.0
 */
export interface WriteCall {
  /** The callee text, used in messages (`setCount`, `writeSignal`). */
  name: string;
  /** The variable written through, when the call goes through a tracked setter. */
  setter: Scope.Variable | null;
  /** True for `writeSignal(node, value, { allowInMemo: true })`. */
  allowsMemo: boolean;
}

/**
 * Recognizes a call that writes reactive state: a call of a tracked setter (`setCount(...)`, see
 * {@link ReactiveModel.setters}) or of the framework's `writeSignal(...)`.
 *
 * `allowsMemo` is `true` only when the third argument of `writeSignal` is an object literal with a
 * property `allowInMemo` whose value is the literal `true`.
 *
 * @param context The rule context.
 * @param model The file's model, from {@link reactiveModel}.
 * @param call A `CallExpression` node.
 * @returns The write, or `null` when the call writes nothing tracked.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { reactiveModel, writeCallOf } from "@shadow-js/eslint-plugin/utils/reactive";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   const model = reactiveModel(context);
 *   return {
 *     CallExpression(node: unknown): void {
 *       const write = writeCallOf(context, model, asAst(node));
 *       if (write !== null && !write.allowsMemo) {
 *         context.report({ loc: asAst(node).loc, message: `${write.name} writes state` });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function writeCallOf(
  context: Context,
  model: ReactiveModel,
  call: AstNode,
): WriteCall | null {
  const callee = at(call, "callee");
  if (callee === null) return null;
  if (callee.type === "Identifier") {
    const variable = resolveVariable(context, callee);
    if (variable !== null && model.setters.has(variable)) {
      return { name: identName(callee) ?? "setter", setter: variable, allowsMemo: false };
    }
  }
  if (shadowApiName(context, callee) === "writeSignal") {
    const options = list(call, "arguments")[2];
    let allowsMemo = false;
    if (options !== undefined && options.type === "ObjectExpression") {
      for (const property of list(options, "properties")) {
        if (property.type !== "Property") continue;
        const key = identName(at(property, "key"));
        const value = at(property, "value");
        // `allowInMemo: true as const` is still the literal `true`: look through TypeScript wrappers.
        const literal = value === null ? null : unwrap(value);
        if (
          key === "allowInMemo" &&
          literal !== null &&
          literal.type === "Literal" &&
          Reflect.get(literal, "value") === true
        ) {
          allowsMemo = true;
        }
      }
    }
    return { name: "writeSignal", setter: null, allowsMemo };
  }
  return null;
}

/**
 * True when evaluating `root` (nested functions excluded) reads something that can change: a
 * tracked accessor or a store view (any reference to the variable, called or not), a binding of
 * the first parameter of a component (`props` itself or a name destructured from it), or a
 * variable whose initializer does (followed up to three levels). Plain constants, literals and
 * calls of ordinary functions with static arguments are not reactive.
 *
 * The property name of a non-computed member (`a.b`) and the key of an object property are not
 * reads.
 *
 * @param context The rule context.
 * @param model The file's model, from {@link reactiveModel}.
 * @param root The expression or statement to inspect.
 * @param visitorKeys The parser's keys, `context.sourceCode.visitorKeys`.
 * @param depth How many initializers have been followed so far; callers pass nothing (default
 * `0`), and initializers are followed while it is below `3`.
 * @returns `true` when a reactive read was found.
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { reactiveModel, readsReactive } from "@shadow-js/eslint-plugin/utils/reactive";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   const model = reactiveModel(context);
 *   return {
 *     IfStatement(node: unknown): void {
 *       const test = at(asAst(node), "test");
 *       if (test !== null && readsReactive(context, model, test, context.sourceCode.visitorKeys)) {
 *         context.report({ loc: test.loc, message: "a reactive condition" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function readsReactive(
  context: Context,
  model: ReactiveModel,
  root: AstNode,
  visitorKeys: SourceCode.VisitorKeys,
  depth = 0,
): boolean {
  let found = false;
  walk(root, visitorKeys, (node) => {
    if (found) return false;
    if (node !== root && isFunction(node)) return false;
    if (node.type !== "Identifier") return true;
    const parent = node.parent;
    // `a.b`: only the object counts; `{ key: v }`: only the value.
    if (
      parent !== null &&
      parent.type === "MemberExpression" &&
      at(parent, "property") === node &&
      Reflect.get(parent, "computed") !== true
    ) {
      return true;
    }
    if (
      parent !== null &&
      parent.type === "Property" &&
      at(parent, "key") === node &&
      at(parent, "value") !== node
    )
      return true;
    const variable = resolveVariable(context, node);
    if (variable === null) return true;
    if (model.accessors.has(variable) || model.stores.has(variable)) {
      found = true;
      return false;
    }
    for (const def of variable.defs) {
      if (def.type === "Parameter") {
        const fn = asAst(def.node);
        const first = list(fn, "params")[0];
        const name = asAst(def.name);
        const inFirst =
          first !== undefined && first.range[0] <= name.range[0] && name.range[1] <= first.range[1];
        if (inFirst && isComponent(fn, visitorKeys)) {
          found = true;
          return false;
        }
      } else if (def.type === "Variable" && depth < 3) {
        const declarator = asAst(def.node);
        const init = at(declarator, "init");
        if (init !== null && readsReactive(context, model, init, visitorKeys, depth + 1)) {
          found = true;
          return false;
        }
      }
    }
    return true;
  });
  return found;
}
