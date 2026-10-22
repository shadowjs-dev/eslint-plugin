import { type AstNode, at, enclosingFunction, identName, isWrapper, list } from "./ast";
import { memberName } from "./reactive";
import { type Context, shadowApiName } from "./scope";

/**
 * Array methods that call their callback synchronously, once per element (`sort` and `toSorted`
 * once per comparison). {@link synchronousKind} treats a callback passed to any of them as running
 * where it is written.
 *
 * @example
 * import { ITERATION_METHODS } from "@shadow-js/eslint-plugin/utils/flow";
 *
 * const runsNow: boolean = ITERATION_METHODS.has("map"); // true
 * const runsLater: boolean = ITERATION_METHODS.has("then"); // false
 * @since 1.0.0
 */
export const ITERATION_METHODS: ReadonlySet<string> = new Set([
  "map",
  "forEach",
  "filter",
  "reduce",
  "reduceRight",
  "flatMap",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "sort",
  "toSorted",
]);

/** Framework functions that run their callback right away. */
const SYNC_RUNNERS = new Set(["batch", "untrack", "runWithOwner", "flushSync", "catchError"]);

/**
 * How a function is run synchronously by the call it is written in, or `null` when it may run
 * later.
 *
 * - `"iife"`: the function is the callee itself, `(() => ...)()`.
 * - `"iteration"`: it is an argument of a member call named in {@link ITERATION_METHODS}
 *   (`rows.map(fn)`), or of `Array.from(...)`.
 * - `"runner"`: it is an argument of a framework API that runs it right away: `batch`, `untrack`,
 *   `runWithOwner`, `flushSync` or `catchError` (resolved with `shadowApiName`).
 *
 * TypeScript wrappers around the function (`(() => ...) as () => void`, `fn!`, `fn satisfies T`) are looked
 * through, so the call they are passed to is the one inspected. Parentheses are not nodes.
 *
 * @param context The rule context (used to resolve framework imports).
 * @param fn A function node.
 * @returns The kind of synchronous call, or `null` when the parent is not a call, the function is
 * not its callee or one of its arguments, or the call is none of the above.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { synchronousKind } from "@shadow-js/eslint-plugin/utils/flow";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     ArrowFunctionExpression(node: unknown): void {
 *       const fn = asAst(node);
 *       if (synchronousKind(context, fn) === "iteration") {
 *         context.report({ loc: fn.loc, message: "runs once per element" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link owningFunction}
 */
export function synchronousKind(
  context: Context,
  fn: AstNode,
): "iife" | "iteration" | "runner" | null {
  // A TypeScript wrapper (`(() => ...) as () => void`, `fn!`, `fn satisfies T`) does not change when
  // the function runs, so the call is the first node above the wrappers.
  let top = fn;
  let parent = fn.parent;
  while (parent !== null && isWrapper(parent)) {
    top = parent;
    parent = parent.parent;
  }
  if (parent === null || parent.type !== "CallExpression") return null;
  const callee = at(parent, "callee");
  if (callee === null) return null;
  if (callee === top) return "iife";
  if (!list(parent, "arguments").includes(top)) return null;
  if (callee.type === "MemberExpression") {
    const name = memberName(callee);
    if (name !== undefined && ITERATION_METHODS.has(name)) return "iteration";
  }
  const api = shadowApiName(context, callee);
  if (api !== null && SYNC_RUNNERS.has(api)) return "runner";
  if (callee.type === "MemberExpression" && identName(at(callee, "object")) === "Array") {
    const name = memberName(callee);
    if (name === "from") return "iteration";
  }
  return null;
}

/**
 * The function that decides when a node runs, as {@link owningFunction} reports it.
 *
 * @example
 * import type { OwningFunction } from "@shadow-js/eslint-plugin/utils/flow";
 *
 * export function runsAtModuleLevel(owner: OwningFunction): boolean {
 *   return owner.fn === null;
 * }
 * @since 1.0.0
 */
export interface OwningFunction {
  /** The nearest enclosing function that is not run synchronously by its caller, or `null`. */
  fn: AstNode | null;
  /** True when an array-iteration callback sits between `node` and `fn`. */
  viaIteration: boolean;
}

/**
 * Finds the function whose body decides when `node` executes. Callbacks that run synchronously
 * (IIFEs, `.map(...)`, `batch(...)`; see {@link synchronousKind}) are looked through; any other
 * function (an event handler, a `useEffect` callback, a timer callback) is its own owner.
 *
 * @param context The rule context (used to resolve framework imports).
 * @param node The node whose timing is wanted, such as a signal write.
 * @returns The owning function (`null` when only synchronous callbacks, or none, sit between `node`
 * and the module level) and whether an array-iteration callback was looked through.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { owningFunction } from "@shadow-js/eslint-plugin/utils/flow";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     AwaitExpression(node: unknown): void {
 *       const { fn, viaIteration } = owningFunction(context, asAst(node));
 *       if (fn !== null && viaIteration) {
 *         context.report({ loc: asAst(node).loc, message: "await inside an iteration callback" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function owningFunction(context: Context, node: AstNode): OwningFunction {
  let fn = enclosingFunction(node);
  let viaIteration = false;
  while (fn !== null) {
    const kind = synchronousKind(context, fn);
    if (kind === null) return { fn, viaIteration };
    if (kind === "iteration") viaIteration = true;
    fn = enclosingFunction(fn);
  }
  return { fn: null, viaIteration };
}
