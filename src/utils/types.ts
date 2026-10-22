import type { AstNode } from "./ast";
import type { Context } from "./scope";

/**
 * The slice of a TypeScript `Type` the rules use, declared structurally so the plugin never imports
 * `typescript`.
 *
 * @example
 * import type { TypeLike } from "@shadow-js/eslint-plugin/utils/types";
 *
 * export function isCallable(type: TypeLike): boolean {
 *   if (type.isUnion()) return (type.types ?? []).some(isCallable);
 *   return type.getCallSignatures().length > 0 && type.getConstructSignatures().length === 0;
 * }
 * @since 1.0.0
 */
export interface TypeLike {
  /** The members of a union type; absent on other types. */
  readonly types?: readonly TypeLike[];
  /** The call signatures of the type (empty when it cannot be called). */
  getCallSignatures(): readonly SignatureLike[];
  /** The construct signatures of the type (empty when it cannot be used with `new`). */
  getConstructSignatures(): readonly unknown[];
  /** True for a union type, whose members are in {@link TypeLike.types}. */
  isUnion(): boolean;
}

/**
 * The slice of a TypeScript call `Signature` the rules use.
 *
 * @example
 * import type { SignatureLike } from "@shadow-js/eslint-plugin/utils/types";
 *
 * export function isNullary(signature: SignatureLike): boolean {
 *   return signature.getParameters().length === 0;
 * }
 * @since 1.0.0
 */
export interface SignatureLike {
  /** The declared parameters (TypeScript symbols, left opaque). */
  getParameters(): readonly unknown[];
  /** The type a call through this signature returns. */
  getReturnType(): TypeLike;
}

/**
 * The slice of a TypeScript `TypeChecker` the rules use.
 *
 * @example
 * import type { CheckerLike } from "@shadow-js/eslint-plugin/utils/types";
 *
 * export function typeText(checker: CheckerLike, tsNode: unknown): string {
 *   return checker.typeToString(checker.getTypeAtLocation(tsNode));
 * }
 * @since 1.0.0
 */
export interface CheckerLike {
  /** The type of a TypeScript node (a `ts.Node`, left opaque). */
  getTypeAtLocation(node: unknown): TypeLike;
  /** The type as TypeScript prints it, such as `Accessor<number>`. */
  typeToString(type: TypeLike): string;
}

interface Services {
  program: unknown;
  map: { get(node: unknown): unknown };
}

function servicesOf(context: Context): Services | null {
  const services: unknown = context.sourceCode.parserServices;
  if (typeof services !== "object" || services === null) return null;
  const program: unknown = Reflect.get(services, "program");
  const map: unknown = Reflect.get(services, "esTreeNodeToTSNodeMap");
  if (program === null || program === undefined) return null;
  if (typeof map !== "object" || map === null || typeof Reflect.get(map, "get") !== "function") {
    return null;
  }
  return { program, map: map as Services["map"] };
}

/**
 * The type checker and the ESTree-to-TypeScript node mapping, when the parser was given type
 * information (typescript-eslint with `parserOptions.project` or `projectService`).
 *
 * Everything is read structurally from `context.sourceCode.parserServices`: it needs a non-null
 * `program` with a `getTypeChecker()` that returns an object with `getTypeAtLocation`, and an
 * `esTreeNodeToTSNodeMap` with a `get` method.
 *
 * @param context The rule context.
 * @returns The checker and `tsNodeOf` (maps a node of this file to its TypeScript node, `undefined`
 * when it has none), or `null` when type information is missing (the plugin's own parser never
 * provides it).
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { typeInfo } from "@shadow-js/eslint-plugin/utils/types";
 *
 * export function create(context: Context) {
 *   const info = typeInfo(context);
 *   return {
 *     Identifier(node: unknown): void {
 *       if (info === null) return;
 *       const tsNode = info.tsNodeOf(asAst(node));
 *       if (tsNode === undefined) return;
 *       const text = info.checker.typeToString(info.checker.getTypeAtLocation(tsNode));
 *       if (text === "any") context.report({ loc: asAst(node).loc, message: "typed as any" });
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link typeOfNode}
 */
export function typeInfo(
  context: Context,
): { checker: CheckerLike; tsNodeOf: (node: AstNode) => unknown } | null {
  const services = servicesOf(context);
  if (services === null) return null;
  const getTypeChecker: unknown = Reflect.get(services.program as object, "getTypeChecker");
  if (typeof getTypeChecker !== "function") return null;
  const checker: unknown = getTypeChecker.call(services.program);
  if (typeof checker !== "object" || checker === null) return null;
  if (typeof Reflect.get(checker, "getTypeAtLocation") !== "function") return null;
  return {
    checker: checker as CheckerLike,
    tsNodeOf: (node) => services.map.get(node),
  };
}

/**
 * The type of an expression, through {@link typeInfo}.
 *
 * @param context The rule context.
 * @param node The expression whose type is wanted.
 * @returns The type and the checker that produced it, or `null` when the parser gave no type
 * information or the node has no TypeScript counterpart.
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 * import { typeOfNode } from "@shadow-js/eslint-plugin/utils/types";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const callee = at(asAst(node), "callee");
 *       const typed = callee === null ? null : typeOfNode(context, callee);
 *       if (callee !== null && typed !== null && typed.type.isUnion()) {
 *         context.report({ loc: callee.loc, message: "calls a union" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function typeOfNode(
  context: Context,
  node: AstNode,
): { type: TypeLike; checker: CheckerLike } | null {
  const info = typeInfo(context);
  if (info === null) return null;
  const tsNode = info.tsNodeOf(node);
  if (tsNode === undefined) return null;
  return { type: info.checker.getTypeAtLocation(tsNode), checker: info.checker };
}
