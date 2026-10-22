import type { AST, SourceCode } from "eslint";

/**
 * Structural view of an ESTree / TSESTree / JSX node.
 *
 * Rules navigate with the typed accessors of this module ({@link at}, {@link list}, {@link str})
 * instead of indexing, so one definition covers the JSX and TypeScript nodes that `estree` does not
 * model. Only the members every node carries are declared.
 *
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { type AstNode, asAst } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const call: AstNode = asAst(node);
 *       if (call.parent !== null && call.parent.type === "ExpressionStatement") {
 *         context.report({ loc: asAst(node).loc, message: `unused call result at offset ${call.range[0]}` });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export interface AstNode {
  /** The node type, such as `CallExpression`, `JSXElement` or `TSAsExpression`. */
  readonly type: string;
  /** Start and end offsets of the node in the source text (end exclusive). */
  readonly range: [number, number];
  /** Line and column of the start and end of the node. */
  readonly loc: AST.SourceLocation;
  /** The enclosing node, or `null` for the `Program` root. */
  readonly parent: AstNode | null;
}

/**
 * True for values that look like an AST node: a non-null object whose `type` is a string.
 *
 * The check is structural only; `range`, `loc` and `parent` are not inspected.
 *
 * @param value Any value, such as a property read from a node.
 * @returns `true` when `value` is an object with a string `type`, narrowing it to {@link AstNode}.
 * @example
 * import { isNode } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * const yes: boolean = isNode({ type: "Identifier", name: "count" }); // true
 * const no: boolean = isNode("Identifier"); // false
 * @since 1.0.0
 * @see {@link asAst}
 */
export function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
  );
}

/**
 * Narrows an ESLint-typed node (or any listener argument) to {@link AstNode}.
 *
 * @param value The value to narrow, usually the node a rule listener receives.
 * @returns The same value, typed as {@link AstNode}.
 * @throws TypeError `shadow: expected an AST node` when `value` fails {@link isNode}.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     Identifier(node: unknown): void {
 *       const identifier = asAst(node);
 *       if (identifier.parent === null) context.report({ loc: asAst(node).loc, message: "detached identifier" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function asAst(value: unknown): AstNode {
  if (!isNode(value)) throw new TypeError("shadow: expected an AST node");
  return value;
}

/**
 * Reads a string-valued property of a node.
 *
 * @param node The node to read from.
 * @param key The property name, such as `name` or `operator`.
 * @returns The value under `key` when it is a string, otherwise `undefined`.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, str } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     BinaryExpression(node: unknown): void {
 *       if (str(asAst(node), "operator") === "==") context.report({ loc: asAst(node).loc, message: "use ===" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function str(node: AstNode, key: string): string | undefined {
  const value: unknown = Reflect.get(node, key);
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads a boolean flag of a node, such as `async`, `generator` or `computed`.
 *
 * @param node The node to read from.
 * @param key The property name.
 * @returns `true` only when the value under `key` is exactly `true`; `false` when it is absent or
 * anything else.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, flag } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     ArrowFunctionExpression(node: unknown): void {
 *       if (flag(asAst(node), "async")) context.report({ loc: asAst(node).loc, message: "async arrow" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function flag(node: AstNode, key: string): boolean {
  return Reflect.get(node, key) === true;
}

/**
 * Reads a single child node of a node.
 *
 * @param node The parent node.
 * @param key The property that holds the child, such as `callee`, `id` or `init`.
 * @returns The value under `key` when it passes {@link isNode}, otherwise `null`.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, at, identName } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       if (identName(at(asAst(node), "callee")) === "eval") {
 *         context.report({ loc: asAst(node).loc, message: "no eval" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function at(node: AstNode, key: string): AstNode | null {
  const value: unknown = Reflect.get(node, key);
  return isNode(value) ? value : null;
}

/**
 * Reads an array of child nodes, such as `arguments`, `params` or `body`.
 *
 * @param node The parent node.
 * @param key The property that holds the array.
 * @returns The elements that pass {@link isNode}, in order; `null` holes and non-nodes are dropped.
 * An empty array when the value under `key` is not an array.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, list } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       if (list(asAst(node), "arguments").length > 3) {
 *         context.report({ loc: asAst(node).loc, message: "too many arguments" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link slots} to keep the holes.
 */
export function list(node: AstNode, key: string): AstNode[] {
  const value: unknown = Reflect.get(node, key);
  return Array.isArray(value) ? value.filter(isNode) : [];
}

/**
 * Reads an array of child nodes keeping its positions, for array patterns where a hole matters
 * (`const [, setCount] = ...`).
 *
 * @param node The parent node.
 * @param key The property that holds the array, usually `elements`.
 * @returns One entry per array element: the node, or `null` for a hole or a non-node. An empty
 * array when the value under `key` is not an array.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, slots } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     ArrayPattern(node: unknown): void {
 *       const [first] = slots(asAst(node), "elements");
 *       if (first === null) context.report({ loc: asAst(node).loc, message: "the accessor is skipped" });
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link list}
 */
export function slots(node: AstNode, key: string): Array<AstNode | null> {
  const value: unknown = Reflect.get(node, key);
  if (!Array.isArray(value)) return [];
  return value.map((item: unknown) => (isNode(item) ? item : null));
}

/**
 * The name of an `Identifier` or `JSXIdentifier`.
 *
 * @param node The node to read, or `null` (the result of an {@link at} that found nothing).
 * @returns The `name` of an `Identifier` or `JSXIdentifier`; `undefined` for `null` and for any
 * other node type.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, at, identName } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     VariableDeclarator(node: unknown): void {
 *       const name = identName(at(asAst(node), "id"));
 *       if (name === "x") context.report({ loc: asAst(node).loc, message: "use a descriptive name" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function identName(node: AstNode | null): string | undefined {
  if (node === null) return undefined;
  if (node.type === "Identifier" || node.type === "JSXIdentifier") return str(node, "name");
  return undefined;
}

const TS_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "ParenthesizedExpression",
]);

/**
 * True for the wrappers {@link unwrap} removes: `TSAsExpression`, `TSSatisfiesExpression`,
 * `TSNonNullExpression`, `TSTypeAssertion`, `TSInstantiationExpression` and
 * `ParenthesizedExpression`.
 *
 * @param node The node to test.
 * @returns `true` when the node type is one of those wrappers.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, isWrapper } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     Identifier(node: unknown): void {
 *       const parent = asAst(node).parent;
 *       if (parent !== null && isWrapper(parent)) context.report({ loc: asAst(node).loc, message: "wrapped" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function isWrapper(node: AstNode): boolean {
  return TS_WRAPPERS.has(node.type);
}

/**
 * Strips parentheses, `as`, `satisfies`, `!`, `<T>expr` and `expr<T>` wrappers around an
 * expression, however deeply they nest.
 *
 * @param node The expression to unwrap.
 * @returns The innermost expression that is not a wrapper (see {@link isWrapper}); `node` itself
 * when it is not wrapped.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, at, unwrap } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       // `(handler as Handler)!()` has the identifier `handler` as its real callee.
 *       const callee = at(asAst(node), "callee");
 *       if (callee !== null && unwrap(callee).type === "Identifier") {
 *         context.report({ loc: asAst(node).loc, message: "direct call" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function unwrap(node: AstNode): AstNode {
  let current = node;
  while (TS_WRAPPERS.has(current.type)) {
    const inner = at(current, "expression");
    if (inner === null) break;
    current = inner;
  }
  return current;
}

/**
 * True for function expressions, arrow functions and function declarations.
 *
 * @param node The node to test, or `null`.
 * @returns `true` for `ArrowFunctionExpression`, `FunctionExpression` and `FunctionDeclaration`;
 * `false` for `null` and every other type.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, at, isFunction } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     VariableDeclarator(node: unknown): void {
 *       if (isFunction(at(asAst(node), "init"))) context.report({ loc: asAst(node).loc, message: "function" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function isFunction(node: AstNode | null): boolean {
  return (
    node !== null &&
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration")
  );
}

/**
 * True for JSX elements (`<div />`) and fragments (`<></>`).
 *
 * @param node The node to test.
 * @returns `true` for `JSXElement` and `JSXFragment`.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, at, isJsx } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     ReturnStatement(node: unknown): void {
 *       const value = at(asAst(node), "argument");
 *       if (value !== null && isJsx(value)) context.report({ loc: asAst(node).loc, message: "returns JSX" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function isJsx(node: AstNode): boolean {
  return node.type === "JSXElement" || node.type === "JSXFragment";
}

/**
 * The direct children of a node, found through the parser's visitor keys, so type annotations and
 * other parser-specific children are visited exactly as ESLint visits them.
 *
 * @param node The parent node.
 * @param visitorKeys The parser's keys, `context.sourceCode.visitorKeys`.
 * @returns The child nodes in visitor-key order (array children flattened, non-nodes skipped). An
 * empty array when the node type has no visitor keys.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, childrenOf } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     BlockStatement(node: unknown): void {
 *       if (childrenOf(asAst(node), context.sourceCode.visitorKeys).length === 0) {
 *         context.report({ loc: asAst(node).loc, message: "empty block" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function childrenOf(node: AstNode, visitorKeys: SourceCode.VisitorKeys): AstNode[] {
  const keys = visitorKeys[node.type];
  const out: AstNode[] = [];
  if (keys === undefined) return out;
  for (const key of keys) {
    const value: unknown = Reflect.get(node, key);
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

/**
 * What the `enter` callback of {@link walk} returns: `false` skips the children of the node just
 * visited; `true` or `undefined` descends into them.
 *
 * @example
 * import type { WalkResult } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * const skipChildren: WalkResult = false;
 * const descend: WalkResult = undefined;
 * @since 1.0.0
 */
export type WalkResult = boolean | undefined;

/**
 * Iterative depth-first walk of a subtree. It is iterative because source nesting depth is user
 * controlled and a recursive walk could overflow the stack.
 *
 * Nodes are visited in pre-order: a node, then its children in visitor-key order (see
 * {@link childrenOf}). Nested functions are entered; use {@link someInFunction} to stop at them.
 *
 * @param root The first node visited.
 * @param visitorKeys The parser's keys, `context.sourceCode.visitorKeys`.
 * @param enter Called once per visited node; returning `false` skips that node's children.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, walk } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     Program(node: unknown): void {
 *       let calls = 0;
 *       walk(asAst(node), context.sourceCode.visitorKeys, (child) => {
 *         if (child.type === "CallExpression") calls += 1;
 *         return true;
 *       });
 *       if (calls > 100) context.report({ loc: asAst(node).loc, message: "too many calls" });
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function walk(
  root: AstNode,
  visitorKeys: SourceCode.VisitorKeys,
  enter: (node: AstNode) => WalkResult,
): void {
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (enter(node) === false) continue;
    const kids = childrenOf(node, visitorKeys);
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      if (kid !== undefined) stack.push(kid);
    }
  }
}

/**
 * True when some node of the subtree satisfies `predicate`, without entering nested functions.
 *
 * `root` itself is tested and, when it is a function, its own body is searched; any other function
 * inside it is tested as a node but its body is skipped. The walk stops at the first match.
 *
 * @param root The subtree to search, usually a function.
 * @param visitorKeys The parser's keys, `context.sourceCode.visitorKeys`.
 * @param predicate The test applied to each visited node.
 * @returns `true` as soon as a visited node satisfies `predicate`, otherwise `false`.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, someInFunction } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     FunctionDeclaration(node: unknown): void {
 *       const awaits = someInFunction(
 *         asAst(node),
 *         context.sourceCode.visitorKeys,
 *         (child) => child.type === "AwaitExpression",
 *       );
 *       if (awaits) context.report({ loc: asAst(node).loc, message: "awaits in its own body" });
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link walk}
 */
export function someInFunction(
  root: AstNode,
  visitorKeys: SourceCode.VisitorKeys,
  predicate: (node: AstNode) => boolean,
): boolean {
  let found = false;
  walk(root, visitorKeys, (node) => {
    if (found) return false;
    if (node !== root && isFunction(node)) return false;
    if (predicate(node)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * The nearest function that contains `node` (its parameters or its body), found by walking the
 * `parent` chain. When `node` is itself a function, the search starts at its parent.
 *
 * @param node The node to start from.
 * @returns The closest ancestor that passes {@link isFunction}, or `null` at module level.
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { asAst, enclosingFunction } from "@shadow-js/eslint-plugin/utils/ast";
 *
 * export function create(context: Context) {
 *   return {
 *     AwaitExpression(node: unknown): void {
 *       if (enclosingFunction(asAst(node)) === null) {
 *         context.report({ loc: asAst(node).loc, message: "top-level await" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see owningFunction in `flow.ts`, which looks through synchronous callbacks.
 */
export function enclosingFunction(node: AstNode): AstNode | null {
  let current = node.parent;
  while (current !== null) {
    if (isFunction(current)) return current;
    current = current.parent;
  }
  return null;
}
