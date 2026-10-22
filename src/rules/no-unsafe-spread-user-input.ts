import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, asAst, at, list, unwrap } from "../utils/ast";
import { dottedPath, isIntrinsicTag, jsxTagName } from "../utils/jsx";
import { resolveVariable } from "../utils/scope";

/** Calls whose result is data from outside the program. */
const UNTRUSTED_CALLS = new Set([
  "JSON.parse",
  "Object.fromEntries",
  "qs.parse",
  "parseQuery",
  "useSearchParams",
  "useParams",
  "useRouteParams",
  "getQuery",
  "getSearchParams",
  "readFormData",
]);
/** Dotted prefixes of values that come from the user or the network. */
const UNTRUSTED_ROOTS =
  /^(?:window\.location|document\.location|location|event|req|request|ctx\.request|formData|searchParams|userInput|untrusted\w*|rawProps|externalProps|payload)(?:\.|$)/;
const DEFAULT_SANITIZERS = [
  "pick",
  "allow",
  "allowlist",
  "allowAttributes",
  "sanitizeProps",
  "splitProps",
];

interface Options {
  sources?: string[];
  sanitizers?: string[];
}

/**
 * Disallow spreading untrusted data onto DOM elements.
 *
 * What it catches and why: `<div {...obj} />` copies every key of `obj` onto the element: `on*`
 * handlers, `href`, `style`, `innerHTML`. If `obj` comes from the URL, a form or parsed JSON,
 * whoever controls it controls the element. The rule reports a spread attribute on a DOM element
 * (a lower-case tag) whose value is untrusted:
 * - a call of `JSON.parse`, `Object.fromEntries`, `qs.parse`, `parseQuery`, `useSearchParams`,
 *   `useParams`, `useRouteParams`, `getQuery`, `getSearchParams` or `readFormData`;
 * - a value under `window.location`, `document.location`, `location`, `event`, `req`, `request`,
 *   `ctx.request`, `formData`, `searchParams`, `userInput`, `untrusted*`, `rawProps`,
 *   `externalProps` or `payload`;
 * - a variable initialized from one of those, an object literal that spreads one, or the result
 *   of an unknown function that is handed one (followed up to three levels).
 *
 * The value is looked at through `?.`, `await` (so `const a = await readFormData(req)` in an async
 * component is followed), TypeScript wrappers, and either branch of `?:`, `||`, `??` and `&&`.
 *
 * A call of a sanitizer (by default `pick`, `allow`, `allowlist`, `allowAttributes`,
 * `sanitizeProps`, `splitProps`) is trusted. Components are not checked: a component decides for
 * itself what to do with its props.
 *
 * Incorrect:
 *
 * ```tsx
 * <div {...JSON.parse(text)} />
 * ```
 *
 * ```tsx
 * <input {...Object.fromEntries(new FormData(form))} />
 * ```
 *
 * ```tsx
 * <a {...searchParams} />
 * ```
 *
 * ```tsx
 * const attrs = JSON.parse(raw);
 * const view = <div {...attrs} />;
 * ```
 *
 * Correct:
 *
 * ```tsx
 * <div {...props} />
 * ```
 *
 * ```tsx
 * <div {...pick(JSON.parse(text), ['id', 'title'])} />
 * ```
 *
 * ```tsx
 * <Widget {...JSON.parse(text)} />
 * ```
 *
 * Options: one object.
 * - `sources` (array of regular expressions as strings, default none): more untrusted sources,
 *   matched against the dotted path of a callee (`api.read`) and of a value (`store.input`), in
 *   addition to the built-in ones.
 * - `sanitizers` (array of dotted function names, default
 *   `["pick", "allow", "allowlist", "allowAttributes", "sanitizeProps", "splitProps"]`): functions
 *   that restrict the keys. The list replaces the default one.
 *
 * Autofix: the rule does not fix code.
 *
 * Disabling: `// eslint-disable-next-line shadow/no-unsafe-spread-user-input` for one line, or a
 * block between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/no-unsafe-spread-user-input *\/
 * /* eslint-enable shadow/no-unsafe-spread-user-input *\/
 * ```
 *
 * A disable is legitimate when the data only looks untrusted, for example a `payload` your own
 * code built from fixed keys. When a function of yours restricts the keys, list it in
 * `sanitizers` instead.
 *
 * Configs:
 * - `recommended`: `"warn"`
 * - `strict`: `"error"`
 * - `migration`: `"warn"`
 * - `dusk`: `"warn"`
 *
 * @example
 * ```ts
 * import shadow from "@shadow-js/eslint-plugin";
 *
 * export default [
 *   shadow.configs.recommended,
 *   {
 *     rules: {
 *       "shadow/no-unsafe-spread-user-input": ["error", { sanitizers: ["pick", "cleanAttributes"] }],
 *     },
 *   },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/no-unsafe-spread-user-input.md
 */
export const noUnsafeSpreadUserInput: ShadowRule = defineRule({
  name: "no-unsafe-spread-user-input",
  id: "ESL-12",
  type: "problem",
  description: "Disallow spreading untrusted data onto DOM elements.",
  recommended: true,
  rationale:
    "`<div {...obj} />` copies every key of `obj` onto the element: `on*` handlers, `href`, `style`, " +
    "`innerHTML`. If `obj` comes from the URL, a form or parsed JSON, whoever controls it controls the " +
    "element. Copy the keys you expect (`pick`, or explicit attributes) instead of spreading everything.",
  examples: {
    incorrect: [
      "<div {...JSON.parse(text)} />",
      "<input {...Object.fromEntries(new FormData(form))} />",
      "<a {...searchParams} />",
      "const attrs = JSON.parse(raw);\nconst view = <div {...attrs} />;",
    ],
    correct: [
      "<div {...props} />",
      "<div {...pick(JSON.parse(text), ['id', 'title'])} />",
      "<Widget {...JSON.parse(text)} />",
    ],
  },
  notes: [
    "Only DOM elements (lower-case tags) are checked: a component decides for itself what to do with its props.",
    "Sources: `JSON.parse`, `Object.fromEntries`, `useSearchParams`/`useParams`, `location.*`, `event.*`, `request.*`, and variables initialized from them. Option `sources` adds more dotted prefixes (regular expressions as strings) and calls.",
    "Option `sanitizers` (default `pick`, `allow`, `allowlist`, `allowAttributes`, `sanitizeProps`, `splitProps`) names functions that restrict the keys; a list given here replaces the default one.",
    "Followed through `?.`, `await` (in async components too), TypeScript wrappers, and either branch of `?:`, `||`, `??` and `&&`.",
  ],
  schema: [
    {
      type: "object",
      properties: {
        sources: { type: "array", items: { type: "string" } },
        sanitizers: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{}],
  disableWhen:
    "When the data only looks untrusted, for example a `payload` your own code built from fixed keys. " +
    "When a function of yours restricts the keys, list it in `sanitizers` instead.",
  messages: {
    unsafeSpread:
      "Spreading `{{source}}` onto <{{tag}}> lets untrusted data set any attribute, including `on*` handlers, `href` and `innerHTML`. Copy the allowed keys explicitly.",
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const options: Options =
      typeof rawOptions === "object" && rawOptions !== null ? (rawOptions as Options) : {};
    const extraSources = (options.sources ?? []).map((source) => new RegExp(source));
    const sanitizers = new Set(options.sanitizers ?? DEFAULT_SANITIZERS);
    const text = context.sourceCode.text;

    /** Why an expression is untrusted (a label for the message), or `null`. */
    const untrusted = (node: AstNode, depth: number): string | null => {
      const value = unwrap(node);
      // Forms that pass the value through: `x?.y`, `await x`, and either branch of `?:`, `||`, `??`,
      // `&&`. Their children are AST children, so this recursion ends at the leaves.
      if (value.type === "ChainExpression") {
        const inner = at(value, "expression");
        return inner === null ? null : untrusted(inner, depth);
      }
      if (value.type === "AwaitExpression") {
        const inner = at(value, "argument");
        return inner === null ? null : untrusted(inner, depth);
      }
      if (value.type === "ConditionalExpression" || value.type === "LogicalExpression") {
        const branches =
          value.type === "ConditionalExpression"
            ? [at(value, "consequent"), at(value, "alternate")]
            : [at(value, "left"), at(value, "right")];
        for (const branch of branches) {
          const reason = branch === null ? null : untrusted(branch, depth);
          if (reason !== null) return reason;
        }
        return null;
      }
      if (value.type === "CallExpression") {
        const callee = at(value, "callee");
        const path = callee === null ? undefined : dottedPath(callee);
        if (path === undefined) return null;
        if (sanitizers.has(path)) return null;
        if (UNTRUSTED_CALLS.has(path) || extraSources.some((re) => re.test(path))) {
          return text.slice(...value.range);
        }
        // An unknown function that is handed untrusted data may hand it back.
        for (const argument of list(value, "arguments")) {
          const reason = depth < 3 ? untrusted(argument, depth + 1) : null;
          if (reason !== null) return reason;
        }
        return null;
      }
      const path = dottedPath(value);
      if (
        path !== undefined &&
        (UNTRUSTED_ROOTS.test(path) || extraSources.some((re) => re.test(path)))
      ) {
        return path;
      }
      if (value.type === "Identifier" && depth < 3) {
        const variable = resolveVariable(context, value);
        if (variable === null) return null;
        for (const def of variable.defs) {
          if (def.type !== "Variable") continue;
          const init = at(asAst(def.node), "init");
          if (init === null) continue;
          const reason = untrusted(init, depth + 1);
          if (reason !== null) return text.slice(...value.range);
        }
      }
      if (value.type === "ObjectExpression") {
        // `{ ...untrusted, extra: 1 }` is still untrusted.
        for (const property of list(value, "properties")) {
          if (property.type !== "SpreadElement") continue;
          const argument = at(property, "argument");
          const reason = argument === null ? null : untrusted(argument, depth + 1);
          if (reason !== null) return reason;
        }
      }
      return null;
    };

    return {
      JSXSpreadAttribute(node) {
        const opening = node.parent;
        if (opening === null) return;
        const tag = jsxTagName(opening);
        if (!isIntrinsicTag(tag)) return;
        const argument = at(node, "argument");
        if (argument === null) return;
        const source = untrusted(argument, 0);
        if (source === null) return;
        context.report({
          node,
          messageId: "unsafeSpread",
          data: { source, tag: tag ?? "element" },
        });
      },
    };
  },
});
