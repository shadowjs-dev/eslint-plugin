import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, at, flag, identName, isFunction, list, unwrap } from "../utils/ast";
import { shadowApiName } from "../utils/scope";

const EFFECTS = new Set(["useEffect", "useRenderEffect"]);

/** The text of the parameter list of a function, without the parentheses. */
function paramsText(source: string, fn: AstNode): string {
  const params = list(fn, "params");
  const first = params[0];
  const last = params[params.length - 1];
  if (first === undefined || last === undefined) return "";
  return source.slice(first.range[0], last.range[1]);
}

/**
 * Disallow async functions as effect or memo callbacks.
 *
 * What it catches and why: dependency tracking stops at the first `await`, so signals read
 * afterward never re-run the effect, and the promise an async function returns is not a cleanup
 * function. A memo must return its value synchronously, not a promise. The rule reports an `async`
 * function passed as one of the first two arguments of `useEffect` or `useRenderEffect` (which
 * covers the `useEffect(source, fn)` form), and as the first argument of `useMemo`. Start the async
 * work from a synchronous effect, or use `useResource` for data loading.
 *
 * Incorrect:
 *
 * ```tsx
 * useEffect(async () => {
 *   const data = await load(id());
 *   setData(data);
 * });
 * ```
 *
 * ```tsx
 * const total = useMemo(async () => (await fetchTotal()) + extra());
 * ```
 *
 * Correct:
 *
 * ```tsx
 * useEffect(() => {
 *   const current = id();
 *   void (async () => {
 *     setData(await load(current));
 *   })();
 * });
 * ```
 *
 * ```tsx
 * const data = useResource(id, (value) => load(value));
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: no automatic fix. For an effect, the suggestion keeps the parameters and wraps the body
 * in a synchronous callback: `(params) => { void (async () => body)(); }` (a `function` expression
 * keeps the `function` form and its name, so a call to itself still resolves). Signals read after
 * an `await` are still not tracked, so read them before the async part. The suggestion is withheld
 * for a function with type parameters or a return type annotation, and is never offered for
 * `useMemo` (use `useResource` there).
 *
 * Disabling: `// eslint-disable-next-line shadow/no-async-effect` above the line, or a block between
 * `/* eslint-disable shadow/no-async-effect *\/` and `/* eslint-enable shadow/no-async-effect *\/`.
 * A disable is legitimate only when the callback reads no signal and returns no cleanup, so neither
 * the lost tracking nor the ignored promise matters.
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
 * export default [shadow.configs.recommended, { rules: { "shadow/no-async-effect": "error" } }];
 * ```
 * @since 1.0.0
 * @see docs/rules/no-async-effect.md
 */
export const noAsyncEffect: ShadowRule = defineRule({
  name: "no-async-effect",
  id: "ESL-06",
  type: "problem",
  description: "Disallow async functions as effect or memo callbacks.",
  recommended: true,
  rationale:
    "Dependency tracking stops at the first `await`, so signals read afterward never re-run the effect, " +
    "and the promise an async function returns is not a cleanup function. Start the async work from " +
    "a synchronous effect (or use `useResource` for data loading).",
  examples: {
    incorrect: [
      "useEffect(async () => {\n  const data = await load(id());\n  setData(data);\n});",
      "const total = useMemo(async () => (await fetchTotal()) + extra());",
    ],
    correct: [
      "useEffect(() => {\n  const current = id();\n  void (async () => {\n    setData(await load(current));\n  })();\n});",
      "const data = useResource(id, (value) => load(value));",
    ],
  },
  fix: "For an effect, the suggestion keeps the parameters and wraps the body in a synchronous callback, `(params) => { void (async () => body)(); }`; signals read after an `await` are still not tracked, so read them before the async part. It is withheld for a function with type parameters or a return type annotation, and never offered for `useMemo` (use `useResource` there).",
  disableWhen:
    "Disable it only when the callback reads no signal and returns no cleanup, so neither the lost tracking nor the ignored promise matters.",
  hasSuggestions: true,
  messages: {
    asyncEffect:
      "Effect callbacks must not be async: tracking stops at the first `await` and the returned promise is not a cleanup function.",
    asyncMemo:
      "A memo must return a value synchronously, not a promise. Use `useResource` for asynchronous data.",
    wrapInner: "Run the async work inside a synchronous callback.",
  },
  create(context) {
    const source = context.sourceCode.text;
    const report = (fn: AstNode, messageId: "asyncEffect" | "asyncMemo"): void => {
      const body = at(fn, "body");
      const canWrap =
        body !== null && at(fn, "typeParameters") === null && at(fn, "returnType") === null;
      const bodyText =
        body === null
          ? ""
          : body.type === "ObjectExpression"
            ? `(${source.slice(body.range[0], body.range[1])})`
            : source.slice(body.range[0], body.range[1]);
      const params = paramsText(source, fn);
      // A named function expression keeps its name: the body may call itself by that name.
      const name = identName(at(fn, "id"));
      const wrapped =
        fn.type === "ArrowFunctionExpression"
          ? `(${params}) => {\n  void (async () => ${bodyText})();\n}`
          : `function ${name === undefined ? "" : name}(${params}) {\n  void (async () => ${bodyText})();\n}`;
      context.report({
        node: fn,
        messageId,
        ...(messageId === "asyncEffect" && canWrap
          ? {
              suggest: [
                {
                  messageId: "wrapInner" as const,
                  fix: (fixer) => fixer.replaceTextRange(fn.range, wrapped),
                },
              ],
            }
          : {}),
      });
    };
    return {
      CallExpression(node) {
        const callee = at(node, "callee");
        if (callee === null) return;
        const api = shadowApiName(context, callee);
        if (api === null) return;
        // A TypeScript cast or `satisfies` around the callback does not change what it is.
        const args = list(node, "arguments").map(unwrap);
        if (EFFECTS.has(api)) {
          for (const argument of args.slice(0, 2)) {
            if (isFunction(argument) && flag(argument, "async")) report(argument, "asyncEffect");
          }
        } else if (api === "useMemo") {
          const first = args[0];
          if (first !== undefined && isFunction(first) && flag(first, "async")) {
            report(first, "asyncMemo");
          }
        }
      },
    };
  },
});
