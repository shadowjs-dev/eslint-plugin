import type { SourceCode } from "eslint";
import { type AstNode, at, flag, identName, isFunction, isJsx, isWrapper, list, walk } from "./ast";

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_$]*$/;
const HOOK_NAME = /^use[A-Z0-9]/;

/**
 * True for names the compiler treats as component names: an upper-case ASCII first letter followed
 * by letters, digits, `_` or `$`.
 *
 * @param name The name to test.
 * @returns `true` for `Counter` or `TodoList2`; `false` for `counter` or `Todo-List`.
 * @example
 * import { isComponentName } from "@shadow-js/eslint-plugin/utils/components";
 *
 * const component: boolean = isComponentName("Counter"); // true
 * const helper: boolean = isComponentName("render"); // false
 * @since 1.0.0
 * @see {@link isComponent}
 */
export function isComponentName(name: string): boolean {
  return COMPONENT_NAME.test(name);
}

/**
 * True for hook names: `use` followed by an upper-case ASCII letter or a digit.
 *
 * @param name The name to test.
 * @returns `true` for `useCounter`; `false` for `user` or `use`.
 * @example
 * import { isHookName } from "@shadow-js/eslint-plugin/utils/components";
 *
 * const hook: boolean = isHookName("useCounter"); // true
 * const word: boolean = isHookName("username"); // false
 * @since 1.0.0
 */
export function isHookName(name: string): boolean {
  return HOOK_NAME.test(name);
}

/**
 * The name a function is known by: its own id, the variable it is assigned to, the property it is
 * the value of, or the identifier on the left of an assignment. TypeScript and paren wrappers
 * around the function (`(() => ...) as Component`) are looked through, because the function still
 * runs as that component. The compiler does not rewrite such a component (its `components()` takes
 * only a bare function in a declarator); a rule whose concern is the compiler's rewrite must check
 * that itself, as `no-destructure-props-outside-forgiving` does with `declaredDirectly`.
 *
 * @param fn A function node.
 * @returns The name, or `undefined` for an anonymous function in any other position (a call
 * argument, `export default () => ...`, an assignment to a member).
 * @example
 * import { asAst, isFunction } from "@shadow-js/eslint-plugin/utils/ast";
 * import { functionName } from "@shadow-js/eslint-plugin/utils/components";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     ArrowFunctionExpression(node: unknown): void {
 *       const fn = asAst(node);
 *       if (isFunction(fn) && functionName(fn) === undefined) {
 *         context.report({ loc: fn.loc, message: "anonymous arrow" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link wrappedComponentName}
 */
export function functionName(fn: AstNode): string | undefined {
  const own = identName(at(fn, "id"));
  if (own !== undefined) return own;
  let parent = fn.parent;
  // `const Foo = (() => ...) as Component` and parenthesized forms.
  while (parent !== null && isWrapper(parent)) parent = parent.parent;
  if (parent === null) return undefined;
  if (parent.type === "VariableDeclarator") return identName(at(parent, "id"));
  if (parent.type === "AssignmentExpression") return identName(at(parent, "left"));
  if (parent.type === "Property") return identName(at(parent, "key"));
  if (parent.type === "ExportDefaultDeclaration") return undefined;
  return undefined;
}

/**
 * The name of the variable a wrapped function ends up in: `memo(function ...)`,
 * `forwardRef((props) => ...)`, `observer(memo(...))`.
 *
 * @param fn A function node.
 * @returns The variable name for `const Row = memo((props) => ...)`; `undefined` when the function
 * is not the first argument of a chain of calls (one or more) whose result initializes a variable
 * declared with a plain identifier.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { wrappedComponentName } from "@shadow-js/eslint-plugin/utils/components";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     ArrowFunctionExpression(node: unknown): void {
 *       const name = wrappedComponentName(asAst(node));
 *       if (name !== undefined) context.report({ loc: asAst(node).loc, message: `wrapped ${name}` });
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link functionName}
 */
export function wrappedComponentName(fn: AstNode): string | undefined {
  let current: AstNode = fn;
  let parent = fn.parent;
  let calls = 0;
  while (
    parent !== null &&
    parent.type === "CallExpression" &&
    list(parent, "arguments")[0] === current
  ) {
    current = parent;
    parent = parent.parent;
    calls += 1;
  }
  while (parent !== null && isWrapper(parent)) parent = parent.parent;
  if (calls === 0 || parent === null) return undefined;
  return parent.type === "VariableDeclarator" ? identName(at(parent, "id")) : undefined;
}

const jsxCache = new WeakMap<AstNode, boolean>();

/**
 * True when the function contains a JSX element or fragment anywhere, nested functions included.
 * The answer is cached per function node.
 *
 * @param fn A function node (any node works; its whole subtree is searched).
 * @param visitorKeys The parser's keys, `context.sourceCode.visitorKeys`.
 * @returns `true` when the subtree holds a `JSXElement` or `JSXFragment`.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { containsJsx } from "@shadow-js/eslint-plugin/utils/components";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     FunctionDeclaration(node: unknown): void {
 *       const fn = asAst(node);
 *       if (containsJsx(fn, context.sourceCode.visitorKeys)) {
 *         context.report({ loc: fn.loc, message: "renders JSX" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function containsJsx(fn: AstNode, visitorKeys: SourceCode.VisitorKeys): boolean {
  const cached = jsxCache.get(fn);
  if (cached !== undefined) return cached;
  let found = false;
  walk(fn, visitorKeys, (node) => {
    if (found) return false;
    if (isJsx(node)) {
      found = true;
      return false;
    }
    return true;
  });
  jsxCache.set(fn, found);
  return found;
}

/**
 * True for what the compiler and these rules call a component: a function whose name (see
 * {@link functionName}) passes {@link isComponentName} and whose body contains JSX (see
 * {@link containsJsx}).
 *
 * @param fn The node to test.
 * @param visitorKeys The parser's keys, `context.sourceCode.visitorKeys`.
 * @returns `true` for `function Counter() { return <b />; }`; `false` for non-functions, unnamed or
 * lower-case functions, and functions without JSX.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { isComponent } from "@shadow-js/eslint-plugin/utils/components";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     FunctionDeclaration(node: unknown): void {
 *       const fn = asAst(node);
 *       if (isComponent(fn, context.sourceCode.visitorKeys)) {
 *         context.report({ loc: fn.loc, message: "a component" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link compilerHandlesComponent}
 */
export function isComponent(fn: AstNode, visitorKeys: SourceCode.VisitorKeys): boolean {
  if (!isFunction(fn)) return false;
  const name = functionName(fn);
  if (name === undefined || !isComponentName(name)) return false;
  return containsJsx(fn, visitorKeys);
}

/**
 * True when the compiler's forgiving-reactivity pass handles the component: at most one parameter,
 * not async and not a generator (the same test as `components()` in
 * `packages/compiler/src/internal/derive.ts`). The name is not checked here; see
 * {@link isComponent}.
 *
 * @param fn A function node.
 * @returns `true` when the function is neither async nor a generator and has zero or one parameter.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { compilerHandlesComponent, isComponent } from "@shadow-js/eslint-plugin/utils/components";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     FunctionDeclaration(node: unknown): void {
 *       const fn = asAst(node);
 *       if (isComponent(fn, context.sourceCode.visitorKeys) && !compilerHandlesComponent(fn)) {
 *         context.report({ loc: fn.loc, message: "the compiler skips this component" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function compilerHandlesComponent(fn: AstNode): boolean {
  return !flag(fn, "async") && !flag(fn, "generator") && list(fn, "params").length <= 1;
}
