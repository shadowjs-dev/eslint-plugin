import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, at, identName, list, str, unwrap } from "../utils/ast";
import { jsxAttributeExpression, jsxAttributeName, staticPrefix } from "../utils/jsx";
import { memberName } from "../utils/reactive";

/** Attributes the runtime treats as URLs (see the DOM runtime contract). */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "poster",
  "data",
  "cite",
  "background",
  "codebase",
  "srcdoc",
]);
const URL_PROPERTIES = new Set(["href", "src", "action", "formAction", "poster", "data"]);
const DANGEROUS = ["javascript:", "vbscript:", "data:text/html"];

/** The dangerous scheme a URL starts with after the browser's own normalization, else `null`. */
function dangerousScheme(value: string): string | null {
  // Browsers drop tabs/newlines inside the scheme and ignore leading control characters and spaces.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point here
  const normalized = value.replace(/[\u0000- ]/g, "").toLowerCase();
  return DANGEROUS.find((scheme) => normalized.startsWith(scheme)) ?? null;
}

const NAMED_ENTITIES = new Map<string, string>([
  ["colon", ":"],
  ["Tab", "\t"],
  ["tab", "\t"],
  ["NewLine", "\n"],
  ["newline", "\n"],
]);

/**
 * Decodes the character references of a JSX string attribute. The compiler decodes them before the
 * runtime sees the value (`href="&#106;avascript:x"` is `javascript:x`), so the check must too. Only
 * the references that can spell a scheme are named; an unknown name is left as written, which
 * cannot create a `javascript:` scheme.
 */
function decodeEntities(raw: string): string {
  return raw.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));?/gi,
    (match: string, hex: string | undefined, decimal: string | undefined, name?: string) => {
      if (name !== undefined) return NAMED_ENTITIES.get(name) ?? match;
      const code =
        hex === undefined ? Number.parseInt(decimal ?? "", 10) : Number.parseInt(hex, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    },
  );
}

/** All static prefixes an expression can start with (both branches of `?:`, `||`, `??`). */
function prefixes(node: AstNode): string[] {
  const value = unwrap(node);
  if (value.type === "ConditionalExpression") {
    return [at(value, "consequent"), at(value, "alternate")]
      .filter((branch): branch is AstNode => branch !== null)
      .flatMap(prefixes);
  }
  if (value.type === "LogicalExpression") {
    return [at(value, "left"), at(value, "right")]
      .filter((branch): branch is AstNode => branch !== null)
      .flatMap(prefixes);
  }
  return [staticPrefix(value) ?? ""];
}

/**
 * Disallow `javascript:` (and similar) URLs in URL attributes.
 *
 * What it catches and why: a `javascript:` URL runs code in the page when followed. The DOM runtime
 * refuses to write one (it is not written and development builds warn with `UNSAFE_URL_BLOCKED`),
 * so the link silently does nothing; the code is also a cross-site scripting risk the moment part
 * of the URL comes from data. The rule reports a value whose static start is a `javascript:`,
 * `vbscript:` or `data:text/html` URL, after normalizing case, spaces and control characters as
 * browsers do, in:
 * - the JSX attributes `href`, `src`, `action`, `formaction`, `xlink:href`, `poster`, `data`,
 *   `cite`, `background`, `codebase` and `srcdoc` (any case, also with a `prop:` or `attr:`
 *   prefix);
 * - keys of an object literal spread onto an element (`{...{ href: "javascript:x" }}`);
 * - `element.setAttribute(name, value)` with one of those names;
 * - assignments to `.href`, `.src`, `.action`, `.formAction`, `.poster` and `.data`.
 *
 * Both branches of `?:` and both sides of `||` and `??` are checked, and so are `+` concatenations
 * (`"javascript" + ":" + code`) and values wrapped in `as`, `!` or parentheses. The character
 * references of a JSX string attribute (`href="&#106;avascript:x"`) are decoded first, as the
 * compiler does; a JavaScript string is not (`href={"&#106;avascript:x"}` is that literal text). A
 * value that starts with a dynamic part (`href={url()}`) cannot be judged statically and is not
 * reported.
 *
 * Incorrect:
 *
 * ```tsx
 * <a href="javascript:void(0)">x</a>
 * ```
 *
 * ```tsx
 * <a href={`javascript:${code}`}>x</a>
 * ```
 *
 * ```tsx
 * <iframe src="  JavaScript:alert(1)" />
 * ```
 *
 * ```tsx
 * link.setAttribute("href", "javascript:go()");
 * ```
 *
 * Correct:
 *
 * ```tsx
 * <a href="/home">Home</a>
 * ```
 *
 * ```tsx
 * <button onClick={go}>Go</button>
 * ```
 *
 * ```tsx
 * <a href={url()}>Link</a>
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: the rule does not fix code.
 *
 * Disabling: `// eslint-disable-next-line shadow/jsx-no-script-url` above the line, or a block
 * between `/* eslint-disable shadow/jsx-no-script-url *\/` and
 * `/* eslint-enable shadow/jsx-no-script-url *\/`. A disable is rarely legitimate: only for code
 * that checks the blocking itself, such as a test of the runtime's `UNSAFE_URL_BLOCKED` warning.
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
 * export default [shadow.configs.recommended, { rules: { "shadow/jsx-no-script-url": "error" } }];
 * ```
 * @since 1.0.0
 * @see docs/rules/jsx-no-script-url.md
 */
export const jsxNoScriptUrl: ShadowRule = defineRule({
  name: "jsx-no-script-url",
  id: "ESL-10",
  type: "problem",
  description: "Disallow `javascript:` (and similar) URLs in URL attributes.",
  recommended: true,
  rationale:
    "A `javascript:` URL runs code in the page when followed. The DOM runtime refuses to write one " +
    "(`UNSAFE_URL_BLOCKED`), so the link silently does nothing; the code is also a cross-site scripting " +
    "risk the moment part of the URL comes from data. Use an `onClick` handler instead.",
  examples: {
    incorrect: [
      '<a href="javascript:void(0)">x</a>',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      "<a href={`javascript:${code}`}>x</a>",
      '<iframe src="  JavaScript:alert(1)" />',
      'link.setAttribute("href", "javascript:go()");',
    ],
    correct: [
      '<a href="/home">Home</a>',
      "<button onClick={go}>Go</button>",
      "<a href={url()}>Link</a>",
    ],
  },
  notes: [
    "`vbscript:` and `data:text/html` are reported as well. Case, whitespace and control characters inside the scheme are normalized as browsers do.",
    "URLs that start with a dynamic value (`href={url}`) cannot be judged statically and are not reported.",
    "Also checked: `setAttribute('href', ...)`, assignments to `.href` / `.src` / `.action`, and object literals spread onto an element (`{...{ href: ... }}`). Character references in a JSX string attribute (`href=\"&#106;avascript:\"`) are decoded first, as the compiler does.",
  ],
  disableWhen:
    "A disable is rarely legitimate: only for code that checks the blocking itself, such as a test of the runtime's `UNSAFE_URL_BLOCKED` warning.",
  messages: {
    scriptUrl:
      "`{{attr}}` receives a `{{scheme}}` URL, which runs code when followed (and is blocked by the runtime). Use an event handler instead.",
  },
  create(context) {
    const text = context.sourceCode.text;
    /** Reports the first start that is a dangerous scheme. */
    const reportIfDangerous = (node: AstNode, starts: string[], attr: string): void => {
      for (const start of starts) {
        const scheme = dangerousScheme(start);
        if (scheme !== null) {
          context.report({ node, messageId: "scriptUrl", data: { attr, scheme } });
          return;
        }
      }
    };
    return {
      JSXAttribute(node) {
        const name = jsxAttributeName(node);
        if (name === undefined) return;
        const lower = name.toLowerCase();
        if (
          !URL_ATTRIBUTES.has(lower) &&
          !URL_ATTRIBUTES.has(lower.replace(/^(?:prop|attr):/, ""))
        ) {
          return;
        }
        const value = at(node, "value");
        if (value !== null && value.type === "Literal") {
          // A string attribute is decoded by the compiler, not by JavaScript: read the source text.
          const raw = text.slice(value.range[0] + 1, value.range[1] - 1);
          reportIfDangerous(node, [decodeEntities(raw)], name);
          return;
        }
        const expression = jsxAttributeExpression(node);
        if (expression !== null) reportIfDangerous(node, prefixes(expression), name);
      },
      JSXSpreadAttribute(node) {
        // `{...{ href: "javascript:x" }}` sets the attribute like `href="javascript:x"` does.
        const argument = at(node, "argument");
        const object = argument === null ? null : unwrap(argument);
        if (object === null || object.type !== "ObjectExpression") return;
        for (const property of list(object, "properties")) {
          if (property.type !== "Property" || Reflect.get(property, "computed") === true) continue;
          const key = at(property, "key");
          if (key === null) continue;
          const name = key.type === "Identifier" ? identName(key) : staticPrefix(key);
          if (name === undefined || !URL_ATTRIBUTES.has(name.toLowerCase())) continue;
          const value = at(property, "value");
          if (value !== null) reportIfDangerous(node, prefixes(value), name);
        }
      },
      AssignmentExpression(node) {
        const left = at(node, "left");
        const right = at(node, "right");
        if (left === null || right === null || left.type !== "MemberExpression") return;
        const property = memberName(left);
        if (property === undefined || !URL_PROPERTIES.has(property)) return;
        if (str(node, "operator") !== "=") return;
        reportIfDangerous(node, prefixes(right), property);
      },
      CallExpression(node) {
        const callee = at(node, "callee");
        if (callee === null || callee.type !== "MemberExpression") return;
        if (memberName(callee) !== "setAttribute") return;
        const [nameArg, valueArg] = list(node, "arguments");
        if (nameArg === undefined || valueArg === undefined) return;
        const name = staticPrefix(nameArg);
        if (name === undefined || !URL_ATTRIBUTES.has(name.toLowerCase())) return;
        reportIfDangerous(node, prefixes(valueArg), name);
      },
    };
  },
});
