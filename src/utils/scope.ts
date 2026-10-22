import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";
import { type AstNode, asAst, at, identName, str } from "./ast";

/**
 * The ESLint rule context, as the helpers of this directory take it (`Rule.RuleContext`).
 *
 * @example
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function fileOf(context: Context): string {
 *   return context.filename;
 * }
 * @since 1.0.0
 */
export type Context = Rule.RuleContext;

/** Narrows an {@link AstNode} to the ESTree type the ESLint scope API expects. */
function asEstree(node: AstNode): ESTree.Node {
  // The scope manager only reads `type`, `range` and `parent`, which AstNode carries.
  return node as unknown as ESTree.Node;
}

/**
 * The innermost scope that contains `node`, from ESLint's scope manager.
 *
 * @param context The rule context.
 * @param node A node of the file being linted.
 * @returns The scope `context.sourceCode.getScope(node)` returns: for a function node, the scope
 * of that function.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { type Context, scopeOf } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     Identifier(node: unknown): void {
 *       const identifier = asAst(node);
 *       if (scopeOf(context, identifier).type === "global") {
 *         context.report({ loc: identifier.loc, message: "global scope" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function scopeOf(context: Context, node: AstNode): Scope.Scope {
  return context.sourceCode.getScope(asEstree(node));
}

/**
 * Finds the variable an identifier refers to, looking its name up in the scope that contains it and
 * then in each enclosing scope.
 *
 * @param context The rule context.
 * @param identifier An `Identifier` or `JSXIdentifier` node.
 * @returns The first variable of that name found walking outward, or `null` when the node is not an
 * identifier or no scope declares the name (an undeclared global).
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { type Context, resolveVariable } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const callee = at(asAst(node), "callee");
 *       if (callee !== null && resolveVariable(context, callee) === null) {
 *         context.report({ loc: callee.loc, message: "calls an undeclared function" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link importOf}
 */
export function resolveVariable(context: Context, identifier: AstNode): Scope.Variable | null {
  const name = identName(identifier);
  if (name === undefined) return null;
  let scope: Scope.Scope | null = scopeOf(context, identifier);
  while (scope !== null) {
    const variable = scope.set.get(name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

/**
 * Where a module binding comes from, as {@link importOf} reports it.
 *
 * @example
 * import type { ImportOrigin } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * // import { useSignal as signal } from "@shadow-js/core";
 * const origin: ImportOrigin = { source: "@shadow-js/core", imported: "useSignal" };
 * @since 1.0.0
 */
export interface ImportOrigin {
  /** The module specifier, such as `@shadow-js/core`. */
  source: string;
  /** The exported name (`default` for default imports, `*` for namespace imports). */
  imported: string;
}

/**
 * The import declaration a variable was bound by.
 *
 * @param variable A variable from ESLint's scope manager.
 * @returns The module specifier and the exported name (`default` for a default import, `*` for a
 * namespace import, the original name for a renamed named import), or `null` when no definition of
 * the variable is an import (locals, parameters and globals).
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { type Context, importOf, resolveVariable } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const callee = at(asAst(node), "callee");
 *       const variable = callee === null ? null : resolveVariable(context, callee);
 *       const origin = variable === null ? null : importOf(variable);
 *       if (callee !== null && origin !== null && origin.source === "react") {
 *         context.report({ loc: callee.loc, message: `${origin.imported} comes from React` });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function importOf(variable: Scope.Variable): ImportOrigin | null {
  for (const def of variable.defs) {
    if (def.type !== "ImportBinding") continue;
    const specifier = asAst(def.node);
    const declaration = specifier.parent;
    if (declaration === null) continue;
    const source = at(declaration, "source");
    const value: unknown = source === null ? undefined : Reflect.get(source, "value");
    if (typeof value !== "string") continue;
    if (specifier.type === "ImportSpecifier") {
      const imported = at(specifier, "imported");
      const name = imported === null ? undefined : (identName(imported) ?? str(imported, "value"));
      if (name === undefined) continue;
      return { source: value, imported: name };
    }
    if (specifier.type === "ImportDefaultSpecifier") return { source: value, imported: "default" };
    if (specifier.type === "ImportNamespaceSpecifier") return { source: value, imported: "*" };
  }
  return null;
}

/**
 * True when a module specifier names one of the framework's own packages: `shadow-js` or any
 * `@shadow-js/*` package.
 *
 * @param source A module specifier, as written in an import.
 * @returns `true` for `shadow-js` and for specifiers starting with `@shadow-js/`.
 * @example
 * import { isShadowSource } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * const core: boolean = isShadowSource("@shadow-js/core"); // true
 * const react: boolean = isShadowSource("react"); // false
 * @since 1.0.0
 */
export function isShadowSource(source: string): boolean {
  return source === "shadow-js" || source.startsWith("@shadow-js/");
}

/**
 * The framework API name a callee refers to, or `null` when it is something else.
 *
 * - A named import from a framework package (see {@link isShadowSource}), also when renamed
 *   (`import { useSignal as signal }` gives `useSignal`).
 * - `core.useSignal` where `core` is a namespace import of a framework package (non-computed
 *   member only).
 * - A name the file does not declare (an unbound or configured global, as in snippets and tests)
 *   counts as the API it is named after: an unbound `useSignal` gives `useSignal`.
 * - A local binding, a default import, a namespace object called directly, or an import from
 *   another package is not the framework's.
 *
 * @param context The rule context.
 * @param callee The callee of a call, or a JSX tag name (`Identifier`, `JSXIdentifier` or
 * `MemberExpression`).
 * @returns The exported API name, such as `useSignal`, or `null`.
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { type Context, shadowApiName } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const callee = at(asAst(node), "callee");
 *       if (callee !== null && shadowApiName(context, callee) === "useEffect") {
 *         context.report({ loc: callee.loc, message: "an effect" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function shadowApiName(context: Context, callee: AstNode): string | null {
  if (callee.type === "Identifier" || callee.type === "JSXIdentifier") {
    const variable = resolveVariable(context, callee);
    if (variable === null || variable.defs.length === 0) return identName(callee) ?? null;
    const origin = importOf(variable);
    if (origin !== null && isShadowSource(origin.source) && origin.imported !== "*") {
      return origin.imported === "default" ? null : origin.imported;
    }
    return null;
  }
  if (callee.type === "MemberExpression") {
    const object = at(callee, "object");
    const property = at(callee, "property");
    if (object === null || property === null || object.type !== "Identifier") return null;
    if (Reflect.get(callee, "computed") === true) return null;
    const variable = resolveVariable(context, object);
    if (variable === null) return null;
    const origin = importOf(variable);
    if (origin !== null && isShadowSource(origin.source) && origin.imported === "*") {
      return identName(property) ?? null;
    }
  }
  return null;
}
