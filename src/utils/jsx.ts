import { type AstNode, at, identName, list, str, unwrap } from "./ast";

/**
 * The name of a `JSXAttribute` as written, including a namespace (`xlink:href`, `on:click`).
 *
 * @param attribute A `JSXAttribute` node.
 * @returns The name (`onClick`, or `namespace:name` for a namespaced name), or `undefined` when the
 * node has no name of either form (for example a `JSXSpreadAttribute`).
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { jsxAttributeName } from "@shadow-js/eslint-plugin/utils/jsx";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     JSXAttribute(node: unknown): void {
 *       const attribute = asAst(node);
 *       if (jsxAttributeName(attribute) === "className") {
 *         context.report({ loc: attribute.loc, message: "use class" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function jsxAttributeName(attribute: AstNode): string | undefined {
  const name = at(attribute, "name");
  if (name === null) return undefined;
  if (name.type === "JSXIdentifier") return str(name, "name");
  if (name.type === "JSXNamespacedName") {
    const namespace = str(at(name, "namespace") ?? name, "name");
    const local = str(at(name, "name") ?? name, "name");
    return namespace === undefined || local === undefined ? undefined : `${namespace}:${local}`;
  }
  return undefined;
}

/**
 * The tag name of a JSX element as written: `div`, `Foo`, `Foo.Bar`, `svg:rect`. Pass the parent of
 * a `JSXAttribute` to get the tag the attribute is on.
 *
 * @param element A `JSXElement` or a `JSXOpeningElement`.
 * @returns The tag text, with member chains joined by `.` and namespaces by `:`; `undefined` for a
 * fragment, for other node types, and for name shapes it does not know.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { jsxTagName } from "@shadow-js/eslint-plugin/utils/jsx";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     JSXAttribute(node: unknown): void {
 *       const attribute = asAst(node);
 *       const opening = attribute.parent;
 *       if (opening !== null && jsxTagName(opening) === "iframe") {
 *         context.report({ loc: attribute.loc, message: "attribute on an iframe" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 * @see {@link isIntrinsicTag}
 */
export function jsxTagName(element: AstNode): string | undefined {
  const opening = element.type === "JSXOpeningElement" ? element : at(element, "openingElement");
  if (opening === null) return undefined;
  const name = at(opening, "name");
  if (name === null) return undefined;
  return jsxNameText(name);
}

function jsxNameText(name: AstNode): string | undefined {
  if (name.type === "JSXIdentifier") return str(name, "name");
  if (name.type === "JSXMemberExpression") {
    const object = at(name, "object");
    const property = at(name, "property");
    const left = object === null ? undefined : jsxNameText(object);
    const right = property === null ? undefined : str(property, "name");
    return left === undefined || right === undefined ? undefined : `${left}.${right}`;
  }
  if (name.type === "JSXNamespacedName") {
    return jsxAttributeNameFromNamespaced(name);
  }
  return undefined;
}

function jsxAttributeNameFromNamespaced(name: AstNode): string | undefined {
  const namespace = str(at(name, "namespace") ?? name, "name");
  const local = str(at(name, "name") ?? name, "name");
  return namespace === undefined || local === undefined ? undefined : `${namespace}:${local}`;
}

/**
 * True for tags that map to a DOM element: a lower-case first letter and no member access.
 *
 * @param tag A tag name from {@link jsxTagName}, or `undefined`.
 * @returns `true` for `div` or `svg:rect`; `false` for `Foo`, `foo.bar` and `undefined`.
 * @example
 * import { isIntrinsicTag } from "@shadow-js/eslint-plugin/utils/jsx";
 *
 * const dom: boolean = isIntrinsicTag("button"); // true
 * const component: boolean = isIntrinsicTag("Button"); // false
 * const member: boolean = isIntrinsicTag("ui.button"); // false
 * @since 1.0.0
 */
export function isIntrinsicTag(tag: string | undefined): boolean {
  return tag !== undefined && /^[a-z]/.test(tag) && !tag.includes(".");
}

/**
 * The expression held by an attribute value: the expression of `{expr}`, or the value node itself
 * for any other value (a string literal, for example).
 *
 * @param attribute A `JSXAttribute` node.
 * @returns The value expression, or `null` for an attribute without a value (`<input disabled />`)
 * and for an empty container (`attr={}`).
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { jsxAttributeExpression } from "@shadow-js/eslint-plugin/utils/jsx";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     JSXAttribute(node: unknown): void {
 *       const value = jsxAttributeExpression(asAst(node));
 *       if (value !== null && value.type === "ArrowFunctionExpression") {
 *         context.report({ loc: value.loc, message: "inline handler" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function jsxAttributeExpression(attribute: AstNode): AstNode | null {
  const value = at(attribute, "value");
  if (value === null) return null;
  if (value.type === "JSXExpressionContainer") {
    const expression = at(value, "expression");
    return expression === null || expression.type === "JSXEmptyExpression" ? null : expression;
  }
  return value;
}

/**
 * The text a string expression is known to start with, for checks such as `javascript:` URLs.
 *
 * Wrappers are removed first (see `unwrap`). A string literal gives its whole value, a template
 * literal its first static part (`` `https://${host}` `` gives `https://`). A `+` chain gives the known
 * text from the left: `"java" + "script:" + x` gives `javascript:`, and `x + "a"` gives `undefined`
 * because its left side is dynamic.
 *
 * @param node The expression to inspect.
 * @returns The known leading text (possibly empty), or `undefined` when the expression starts with
 * something dynamic or is not a string.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { jsxAttributeExpression, staticPrefix } from "@shadow-js/eslint-plugin/utils/jsx";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     JSXAttribute(node: unknown): void {
 *       const value = jsxAttributeExpression(asAst(node));
 *       const prefix = value === null ? undefined : staticPrefix(value);
 *       if (value !== null && prefix !== undefined && prefix.startsWith("javascript:")) {
 *         context.report({ loc: value.loc, message: "script URL" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function staticPrefix(node: AstNode): string | undefined {
  let text = "";
  let started = false;
  // The `+` chain is read left to right with an explicit stack, so a long chain cannot overflow.
  const pending: AstNode[] = [node];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    const value = unwrap(current);
    if (value.type === "BinaryExpression" && str(value, "operator") === "+") {
      const left = at(value, "left");
      const right = at(value, "right");
      if (left !== null && right !== null) {
        pending.push(right, left);
        continue;
      }
    }
    const part = stringPart(value);
    if (part === undefined) return started ? text : undefined;
    started = true;
    text += part.text;
    // A dynamic tail ends the known text; a complete literal lets the next operand continue it.
    if (!part.complete) return text;
  }
  return text;
}

/**
 * The text of a string literal or template literal, and whether that text is the whole value (a
 * template with a substitution is complete only up to its first `${`).
 */
function stringPart(value: AstNode): { text: string; complete: boolean } | undefined {
  if (value.type === "Literal") {
    const literal = Reflect.get(value, "value");
    return typeof literal === "string" ? { text: literal, complete: true } : undefined;
  }
  if (value.type === "TemplateLiteral") {
    const first = list(value, "quasis")[0];
    if (first === undefined) return undefined;
    const cooked: unknown = Reflect.get(first, "value");
    const text =
      typeof cooked === "object" && cooked !== null ? Reflect.get(cooked, "cooked") : undefined;
    if (typeof text !== "string") return undefined;
    return { text, complete: list(value, "expressions").length === 0 };
  }
  return undefined;
}

/**
 * True for string literals and template literals without substitutions, after removing wrappers
 * (see `unwrap`).
 *
 * @param node The expression to test.
 * @returns `true` for `"x"`, `` `x` `` and `("x" as const)`; `false` for anything with a dynamic part.
 * @example
 * import { asAst } from "@shadow-js/eslint-plugin/utils/ast";
 * import { isStaticString, jsxAttributeExpression } from "@shadow-js/eslint-plugin/utils/jsx";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     JSXAttribute(node: unknown): void {
 *       const value = jsxAttributeExpression(asAst(node));
 *       if (value !== null && !isStaticString(value)) {
 *         context.report({ loc: value.loc, message: "dynamic value" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function isStaticString(node: AstNode): boolean {
  const value = unwrap(node);
  if (value.type === "Literal") return typeof Reflect.get(value, "value") === "string";
  if (value.type === "TemplateLiteral") return list(value, "expressions").length === 0;
  return false;
}

/**
 * The dotted path of an identifier or a chain of non-computed member accesses, such as
 * `DOMPurify.sanitize` or `this.props.html`. Wrappers are removed at every level (see `unwrap`).
 *
 * @param node The expression to read.
 * @returns The path, or `undefined` when any link is computed (`a[b]`) or the chain starts with
 * something other than an identifier or `this`.
 * @example
 * import { asAst, at } from "@shadow-js/eslint-plugin/utils/ast";
 * import { dottedPath } from "@shadow-js/eslint-plugin/utils/jsx";
 * import type { Context } from "@shadow-js/eslint-plugin/utils/scope";
 *
 * export function create(context: Context) {
 *   return {
 *     CallExpression(node: unknown): void {
 *       const callee = at(asAst(node), "callee");
 *       if (callee !== null && dottedPath(callee) === "document.write") {
 *         context.report({ loc: callee.loc, message: "document.write" });
 *       }
 *     },
 *   };
 * }
 * @since 1.0.0
 */
export function dottedPath(node: AstNode): string | undefined {
  const value = unwrap(node);
  if (value.type === "Identifier") return identName(value);
  if (value.type === "ThisExpression") return "this";
  if (value.type !== "MemberExpression") return undefined;
  if (Reflect.get(value, "computed") === true) return undefined;
  const object = at(value, "object");
  const property = identName(at(value, "property"));
  const left = object === null ? undefined : dottedPath(object);
  return left === undefined || property === undefined ? undefined : `${left}.${property}`;
}
