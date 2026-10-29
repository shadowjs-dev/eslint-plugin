import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, asAst, at, identName, list, str, unwrap } from "../utils/ast";
import { dottedPath, isStaticString, jsxAttributeExpression, jsxAttributeName } from "../utils/jsx";
import { memberName } from "../utils/reactive";
import { importOf, resolveVariable } from "../utils/scope";

const HTML_ATTRIBUTES = new Set(["innerhtml", "outerhtml", "prop:innerhtml", "prop:outerhtml"]);
/** Attributes that hold a whole HTML document, and only do so on an `<iframe>`. */
const IFRAME_ATTRIBUTES = new Set(["srcdoc", "prop:srcdoc"]);
const HTML_PROPERTIES = new Set(["innerHTML", "outerHTML", "srcdoc"]);
const HTML_SINKS = new Set(["insertAdjacentHTML", "createContextualFragment", "write", "writeln"]);

interface Options {
  allowedSanitizers?: string[];
}

const DEFAULT_SANITIZERS = [
  "sanitize",
  "sanitizeHtml",
  "DOMPurify.sanitize",
  "trusted",
  "trustedHtml",
];

/**
 * Disallow `innerHTML` (and similar HTML sinks) with values that are not literals.
 *
 * What it catches and why: `innerHTML` parses a string as markup. With anything but a constant, the
 * string can carry script payloads (`<img onerror=...>`) and becomes a cross-site scripting hole.
 * The rule reports these sinks when their value is not trusted:
 * - the JSX attributes `innerHTML` and `outerHTML` (any case, also with a `prop:` prefix), and the
 *   same keys of an object literal spread onto an element (`{...{ innerHTML: html }}`);
 * - assignments to `.innerHTML` and `.outerHTML`;
 * - the `srcdoc` attribute of an `<iframe>` (also `prop:srcdoc`, and the same key of an object literal
 *   spread onto the iframe) and assignments to `.srcdoc`: the browser parses it as a whole HTML
 *   document, with the same trust rules as `innerHTML`;
 * - `insertAdjacentHTML(position, html)`, `createContextualFragment(html)` and
 *   `document.write(...)` / `document.writeln(...)`;
 * - React's `dangerouslySetInnerHTML`, always, whatever its value.
 *
 * A value is trusted when it is a string literal, a template literal without substitutions, a call
 * of an allowed sanitizer (matched by its exact dotted name), or a `?:` / logical expression whose
 * branches are all trusted. TypeScript wrappers and `await` do not change that, and neither does an
 * indirect call such as `(0, DOMPurify.sanitize)(html)`, which calls its last operand. The name
 * `DOMPurify` must be the real library: the global (also one the configuration declares, or a `declare const DOMPurify`), or a binding that comes from an
 * import, `import()` or `require` (`import DOMPurify from "dompurify"`, `const DOMPurify = createDOMPurify(window)`). A
 * local `DOMPurify` that is anything else (an object or parameter of that name) is not trusted. Render with JSX
 * instead, or pass the value through a sanitizer listed in `allowedSanitizers`.
 *
 * Incorrect:
 *
 * ```tsx
 * <div innerHTML={comment().html} />
 * ```
 *
 * ```tsx
 * el.innerHTML = `<b>${name}</b>`;
 * ```
 *
 * ```tsx
 * <div dangerouslySetInnerHTML={{ __html: html }} />
 * ```
 *
 * ```tsx
 * el.insertAdjacentHTML('beforeend', html);
 * ```
 *
 * Correct:
 *
 * ```tsx
 * <div innerHTML="<b>static</b>" />
 * ```
 *
 * ```tsx
 * <div innerHTML={DOMPurify.sanitize(comment().html)} />
 * ```
 *
 * ```tsx
 * <div>{comment().text}</div>
 * ```
 *
 * Options: one object.
 * - `allowedSanitizers` (string array, default `["sanitize", "sanitizeHtml", "DOMPurify.sanitize",
 *   "trusted", "trustedHtml"]`): calls whose result is trusted, as exact dotted names. Setting it
 *   replaces the default list.
 *
 * Autofix: no automatic fix. For `dangerouslySetInnerHTML={{ __html: value }}` the suggestion
 * replaces the attribute with `innerHTML={value}`, which is then checked like any other value. It is
 * withheld when the attribute value is not an object literal with an `__html` property. Comments
 * inside the value are kept; a comment between the `__html` key and its colon is not.
 *
 * Disabling: `// eslint-disable-next-line shadow/jsx-no-unsafe-inner-html` above the line, or a
 * block between `/* eslint-disable shadow/jsx-no-unsafe-inner-html *\/` and
 * `/* eslint-enable shadow/jsx-no-unsafe-inner-html *\/`. A disable is legitimate only when the
 * value is trusted HTML the rule cannot recognize, such as markup produced by your own build or a
 * sanitizer that is not listed (prefer adding it to `allowedSanitizers`).
 *
 * Configs:
 * - `recommended`: `error`
 * - `strict`: `error`
 * - `migration`: `error`
 * - `dusk`: `error`
 *
 * @example
 * ```js
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [
 *   shadow.configs.recommended,
 *   {
 *     rules: {
 *       "shadow/jsx-no-unsafe-inner-html": ["error", { allowedSanitizers: ["purify.sanitize"] }],
 *     },
 *   },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/jsx-no-unsafe-inner-html.md
 */
export const jsxNoUnsafeInnerHtml: ShadowRule = defineRule({
  name: "jsx-no-unsafe-inner-html",
  id: "ESL-11",
  type: "problem",
  description: "Disallow `innerHTML` (and similar HTML sinks) with values that are not literals.",
  recommended: true,
  rationale:
    "`innerHTML` parses a string as markup. With anything but a constant, the string can carry `<script>`-like " +
    "payloads (`<img onerror=...>`) and becomes a cross-site scripting hole. Render with JSX, or pass the " +
    "value through a sanitizer that this rule is told about (`allowedSanitizers`).",
  examples: {
    incorrect: [
      "<div innerHTML={comment().html} />",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      "el.innerHTML = `<b>${name}</b>`;",
      "<div dangerouslySetInnerHTML={{ __html: html }} />",
      "el.insertAdjacentHTML('beforeend', html);",
    ],
    correct: [
      '<div innerHTML="<b>static</b>" />',
      "<div innerHTML={DOMPurify.sanitize(comment().html)} />",
      "<div>{comment().text}</div>",
    ],
  },
  notes: [
    "Option `allowedSanitizers` (default `sanitize`, `sanitizeHtml`, `DOMPurify.sanitize`, `trusted`, `trustedHtml`) lists calls whose result is trusted. Entries are exact dotted names.",
    "`dangerouslySetInnerHTML` (React) is always reported; the suggestion converts it to `innerHTML`, which is then checked like any other value.",
    "`srcdoc` of an `<iframe>` (and `prop:srcdoc`, and `.srcdoc` assignments) is checked like `innerHTML`: the browser parses it as a whole HTML document.",
    "A sanitizer call may be indirect, `(0, DOMPurify.sanitize)(html)`. The name `DOMPurify` is trusted only when it is the global (also one the configuration declares, or an ambient `declare const DOMPurify`) or comes from an import, `import()` or `require`; a local object or parameter named `DOMPurify` is not the library.",
    "Also checked: `.innerHTML` / `.outerHTML` assignments, `insertAdjacentHTML`, `createContextualFragment`, `document.write`, and the `innerHTML` / `outerHTML` / `dangerouslySetInnerHTML` keys of an object literal spread onto an element.",
  ],
  fix: "For `dangerouslySetInnerHTML={{ __html: value }}` the suggestion replaces the attribute with `innerHTML={value}`, which is then checked like any other value. It is withheld when the attribute value is not an object literal with an `__html` property.",
  disableWhen:
    "Disable it only when the value is trusted HTML the rule cannot recognize, such as markup produced by your own build; for an unlisted sanitizer, add it to `allowedSanitizers` instead.",
  hasSuggestions: true,
  schema: [
    {
      type: "object",
      properties: { allowedSanitizers: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{ allowedSanitizers: DEFAULT_SANITIZERS }],
  messages: {
    unsafeAttribute:
      "`{{attr}}` is set from a value that is not a literal, so markup in it is executed. Render with JSX or sanitize the value (allowed: {{sanitizers}}).",
    unsafeAssignment:
      "`.{{property}}` is assigned a value that is not a literal. Use DOM nodes or sanitize the value (allowed: {{sanitizers}}).",
    unsafeSink:
      "`{{method}}()` parses its argument as HTML. Pass a literal or a sanitized value (allowed: {{sanitizers}}).",
    reactApi:
      "`dangerouslySetInnerHTML` is React's API. Use `innerHTML` with a literal or sanitized value (allowed: {{sanitizers}}).",
    useInnerHtml: "Replace `dangerouslySetInnerHTML` with `innerHTML` and the `__html` value.",
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const options: Options =
      typeof rawOptions === "object" && rawOptions !== null ? (rawOptions as Options) : {};
    const allowed = new Set(options.allowedSanitizers ?? DEFAULT_SANITIZERS);
    const sanitizers = [...allowed].join(", ");
    const text = context.sourceCode.text;

    /**
     * The source of a `__html` value: the text after its `:`, so a comment inside the value survives
     * the rewrite to `innerHTML`. Falls back to the value alone when the shape is unusual.
     */
    const htmlSource = (property: AstNode, value: AstNode): string => {
      const key = at(property, "key");
      if (key === null || Reflect.get(property, "shorthand") === true) {
        return text.slice(...value.range);
      }
      const span = text.slice(key.range[1], value.range[1]);
      const colon = /^\s*:/.exec(span);
      return colon === null ? text.slice(...value.range) : span.slice(colon[0].length).trim();
    };

    /** The leftmost identifier of `a.b.c`, or `undefined` when the chain starts with something else. */
    const rootIdentifier = (node: AstNode): AstNode | undefined => {
      let current = unwrap(node);
      while (current.type === "MemberExpression") {
        const object = at(current, "object");
        if (object === null) return undefined;
        current = unwrap(object);
      }
      return current.type === "Identifier" ? current : undefined;
    };

    /** What a value is read from: `await` and `.member` steps are looked through (`(await import("x")).default`). */
    const sourceOf = (node: AstNode): AstNode | null => {
      let current = unwrap(node);
      for (;;) {
        const next =
          current.type === "AwaitExpression"
            ? at(current, "argument")
            : current.type === "MemberExpression"
              ? at(current, "object")
              : undefined;
        if (next === undefined) return current;
        if (next === null) return null;
        current = unwrap(next);
      }
    };

    /** True when a binding comes from an import, `import()` or `require`, directly or through a call/member of one. */
    const comesFromModule = (identifier: AstNode, depth: number): boolean => {
      const variable = resolveVariable(context, identifier);
      if (variable === null) return identName(identifier) === "require";
      if (importOf(variable) !== null) return true;
      // A bounded chain of `const a = b(...)` hops, so a cycle of aliases cannot loop.
      if (depth >= 4) return false;
      return variable.defs.some((def) => {
        if (def.type !== "Variable") return false;
        const init = at(asAst(def.node), "init");
        const source = init === null ? null : sourceOf(init);
        if (source === null) return false;
        if (source.type === "ImportExpression") return true;
        if (source.type === "CallExpression") {
          const callee = at(source, "callee");
          const root = callee === null ? undefined : rootIdentifier(callee);
          return root !== undefined && comesFromModule(root, depth + 1);
        }
        return (
          source.type === "Identifier" &&
          source !== identifier &&
          comesFromModule(source, depth + 1)
        );
      });
    };

    /**
     * True when the sanitizer named by `callee` is the real one. Only the name `DOMPurify` is checked: a
     * `DOMPurify` that is a local object or a parameter shadows the library and proves nothing. The global
     * and anything bound by an import or `require` pass. Other names are the configuration's word.
     */
    const isRealSanitizer = (callee: AstNode): boolean => {
      const root = rootIdentifier(callee);
      if (root === undefined || identName(root) !== "DOMPurify") return true;
      const variable = resolveVariable(context, root);
      // A name the configuration declares as a global has no definition in the file, and `declare const DOMPurify` only
      // states the type of one: both are the global.
      return (
        variable === null ||
        variable.defs.every(
          (def) => def.type === "Variable" && Reflect.get(def.parent ?? {}, "declare") === true,
        ) ||
        comesFromModule(root, 0)
      );
    };

    const isSanitizerCall = (call: AstNode): boolean => {
      let callee = at(call, "callee");
      // `(0, DOMPurify.sanitize)(html)` calls its last operand, without `this`.
      while (callee !== null && unwrap(callee).type === "SequenceExpression") {
        const expressions = list(unwrap(callee), "expressions");
        callee = expressions[expressions.length - 1] ?? null;
      }
      const path = callee === null ? undefined : dottedPath(callee);
      return callee !== null && path !== undefined && allowed.has(path) && isRealSanitizer(callee);
    };

    const isTrusted = (node: AstNode): boolean => {
      const value = unwrap(node);
      if (isStaticString(value)) return true;
      // `await sanitize(html)`: a sanitizer that returns a promise still returns a sanitized value.
      if (value.type === "AwaitExpression") {
        const argument = at(value, "argument");
        return argument !== null && isTrusted(argument);
      }
      // `DOMPurify?.sanitize(html)` and `sanitize?.(html)` wrap the call in a ChainExpression; the
      // sanitizer still runs, so the result is as trusted as without the `?.`.
      if (value.type === "ChainExpression") {
        const inner = at(value, "expression");
        return inner !== null && isTrusted(inner);
      }
      if (value.type === "CallExpression") return isSanitizerCall(value);
      // `(log(), "<b>x</b>")` evaluates to its last operand.
      if (value.type === "SequenceExpression") {
        const expressions = list(value, "expressions");
        const last = expressions[expressions.length - 1];
        return last !== undefined && isTrusted(last);
      }
      if (value.type === "ConditionalExpression") {
        const branches = [at(value, "consequent"), at(value, "alternate")];
        return branches.every((branch) => branch !== null && isTrusted(branch));
      }
      if (value.type === "LogicalExpression") {
        const right = at(value, "right");
        const left = at(value, "left");
        return right !== null && left !== null && isTrusted(left) && isTrusted(right);
      }
      return false;
    };

    /** True when the attribute or spread belongs to a lower-case `<iframe>` tag (not a component). */
    const onIframe = (attribute: AstNode): boolean => {
      const opening = attribute.parent;
      return opening !== null && identName(at(opening, "name")) === "iframe";
    };

    return {
      JSXAttribute(node) {
        const name = jsxAttributeName(node);
        if (name === undefined) return;
        if (name === "dangerouslySetInnerHTML") {
          const expression = jsxAttributeExpression(node);
          const object = expression === null ? null : unwrap(expression);
          const html =
            object !== null && object.type === "ObjectExpression"
              ? list(object, "properties").find(
                  (property) =>
                    property.type === "Property" && identName(at(property, "key")) === "__html",
                )
              : undefined;
          const htmlValue = html === undefined ? null : at(html, "value");
          const replacement =
            html === undefined || htmlValue === null
              ? null
              : `innerHTML={${htmlSource(html, htmlValue)}}`;
          context.report({
            node,
            messageId: "reactApi",
            data: { sanitizers },
            ...(replacement === null
              ? {}
              : {
                  suggest: [
                    {
                      messageId: "useInnerHtml" as const,
                      fix: (fixer) => fixer.replaceTextRange(node.range, replacement),
                    },
                  ],
                }),
          });
          return;
        }
        const lower = name.toLowerCase();
        if (!HTML_ATTRIBUTES.has(lower) && !(IFRAME_ATTRIBUTES.has(lower) && onIframe(node)))
          return;
        const expression = jsxAttributeExpression(node);
        if (expression === null || isTrusted(expression)) return;
        context.report({ node, messageId: "unsafeAttribute", data: { attr: name, sanitizers } });
      },
      JSXSpreadAttribute(node) {
        // `{...{ innerHTML: html }}` sets the property like `innerHTML={html}` does.
        const argument = at(node, "argument");
        const object = argument === null ? null : unwrap(argument);
        if (object === null || object.type !== "ObjectExpression") return;
        for (const property of list(object, "properties")) {
          if (property.type !== "Property" || Reflect.get(property, "computed") === true) continue;
          const key = at(property, "key");
          const name =
            key === null
              ? undefined
              : key.type === "Identifier"
                ? identName(key)
                : str(key, "value");
          if (name === undefined) continue;
          if (name === "dangerouslySetInnerHTML") {
            context.report({ node, messageId: "reactApi", data: { sanitizers } });
            continue;
          }
          const value = at(property, "value");
          const lower = name.toLowerCase();
          const sink =
            HTML_ATTRIBUTES.has(lower) || (IFRAME_ATTRIBUTES.has(lower) && onIframe(node));
          if (!sink || value === null || isTrusted(value)) continue;
          context.report({ node, messageId: "unsafeAttribute", data: { attr: name, sanitizers } });
        }
      },
      AssignmentExpression(node) {
        const left = at(node, "left");
        const right = at(node, "right");
        if (left === null || right === null || left.type !== "MemberExpression") return;
        const property = memberName(left);
        if (property === undefined || !HTML_PROPERTIES.has(property)) return;
        if (isTrusted(right)) return;
        context.report({ node, messageId: "unsafeAssignment", data: { property, sanitizers } });
      },
      CallExpression(node) {
        const callee = at(node, "callee");
        if (callee === null || callee.type !== "MemberExpression") return;
        const method = memberName(callee);
        if (method === undefined || !HTML_SINKS.has(method)) return;
        if (method === "write" || method === "writeln") {
          const object = at(callee, "object");
          if (object === null || dottedPath(object) !== "document") return;
        }
        const args = list(node, "arguments");
        const html = method === "insertAdjacentHTML" ? args[1] : args[0];
        if (html === undefined || isTrusted(html)) return;
        context.report({ node, messageId: "unsafeSink", data: { method, sanitizers } });
      },
    };
  },
});
