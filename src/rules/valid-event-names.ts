import { EVENT_HANDLERS } from "../data/events";
import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, at, identName, unwrap } from "../utils/ast";
import { isIntrinsicTag, jsxAttributeExpression, jsxAttributeName, jsxTagName } from "../utils/jsx";
import { reactiveModel, writeCallOf } from "../utils/reactive";
import { type Context, resolveVariable } from "../utils/scope";
import { closest } from "../utils/text";

const DOM_EVENTS = new Set(Object.values(EVENT_HANDLERS));
/** Lower-cased handler spellings: `onclick`, `ondoubleclick`, `ondblclick`. */
const HANDLER_LOWER = new Map<string, string>(
  [
    ...Object.keys(EVENT_HANDLERS).map((name) => [name.toLowerCase(), name] as const),
    ...[...DOM_EVENTS].map((event) => [`on${event}`, event] as const),
  ].map(([lower, canonical]) => [lower, canonical]),
);
const GLOBAL_CALLS = new Set(["alert", "confirm", "prompt"]);

/**
 * True when an identifier refers to the global of that name rather than a binding the file declares.
 * A configured global has no definition in the file; a local `alert` or `console` is the file's own.
 *
 * @param context The rule context, for its scope analysis.
 * @param identifier The identifier as written.
 * @returns Whether no declaration in the file shadows the name.
 */
function isGlobalReference(context: Context, identifier: AstNode): boolean {
  const variable = resolveVariable(context, identifier);
  return variable === null || variable.defs.length === 0;
}

/**
 * True for React's capture spelling of a known handler (`onClickCapture`, `onKeyDownCapture`). The
 * compiler's `eventPlan` binds it to the capture phase of the same event; a name that starts in
 * lower case (`onclickCapture`) is not React's spelling and names no event.
 *
 * @param name The attribute name as written.
 * @returns Whether the name is `on`, an upper-case letter, a known handler name, then `Capture`.
 */
function isReactCapture(name: string): boolean {
  const match = /^on([A-Z].*)Capture$/.exec(name);
  return match !== null && HANDLER_LOWER.has(`on${(match[1] ?? "").toLowerCase()}`);
}

/**
 * Require JSX event attributes to name real DOM events and take functions.
 *
 * What it catches and why: a misspelled handler (`onClik`) is just an unknown attribute: no
 * listener is attached and nothing complains. The rule checks the event attributes of DOM elements
 * (lower-case tags; components define their own `onX` props):
 * - an `onX` name must be a known handler, in any casing (`onClick`, `onclick`); the list mirrors
 *   the JSX typings of `@shadow-js/web`. React's capture spelling of a known handler
 *   (`onClickCapture`) is accepted: the compiler binds the capture phase of the same event (the
 *   React spellings table of the DOM runtime contract). A lower-case `onclickCapture` is not a
 *   React spelling and names no event;
 * - `on:` and `oncapture:` accept any event name (custom events), but a DOM event name there must
 *   be lower-case (`on:input`, not `on:Input`);
 * - a handler must be a function: a string is reported (the compiler refuses a string literal with
 *   `STRING_EVENT_HANDLER`), and so is a call that runs while rendering and passes its result:
 *   a signal or store setter, `writeSignal`, a `console` method, `alert`, `confirm` or `prompt`
 *   (the globals: a local binding with one of those names is not judged). An optional call
 *   (`setOpen?.(true)`) counts as a call. Other calls (`onClick={makeHandler(id)}`) may return a
 *   handler and are not reported.
 *
 * Incorrect:
 *
 * ```tsx
 * <button onClik={save}>x</button>
 * ```
 *
 * ```tsx
 * <button onClick="save()">x</button>
 * ```
 *
 * ```tsx
 * const [open, setOpen] = useSignal(false);
 * const view = <button onClick={setOpen(true)}>x</button>;
 * ```
 *
 * ```tsx
 * <input on:Input={update} />
 * ```
 *
 * Correct:
 *
 * ```tsx
 * <button onClick={save}>x</button>
 * ```
 *
 * ```tsx
 * <button oncapture:click={log} onKeyDownCapture={log}>x</button>
 * ```
 *
 * ```tsx
 * <input on:input={update} on:my-custom-event={custom} />
 * ```
 *
 * ```tsx
 * const [open, setOpen] = useSignal(false);
 * const view = <button onClick={() => setOpen(true)}>x</button>;
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: a DOM event name with capital letters after `on:` or `oncapture:` is fixed to lower
 * case. Two suggestions (not autofixes) rename an attribute: an unknown `onX` within two edits of
 * a known handler gets "Rename to" that handler, and a lower-case name with a `Capture` suffix
 * (`onclickCapture`) gets `oncapture:click`. String handlers and handlers called at render are
 * only reported, since the right function cannot be guessed.
 *
 * Disabling: `// eslint-disable-next-line shadow/valid-event-names` for one line, or a block
 * between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/valid-event-names *\/
 * /* eslint-enable shadow/valid-event-names *\/
 * ```
 *
 * A disable is legitimate for a non-standard event that a DOM element really fires but the JSX
 * typings do not list yet; prefer `on:name`, which accepts any event, before disabling.
 *
 * Configs:
 * - `recommended`: `"error"`
 * - `strict`: `"error"`
 * - `migration`: `"error"`
 * - `dusk`: `"error"`
 *
 * @example
 * ```ts
 * import shadow from "@shadow-js/eslint-plugin";
 *
 * export default [shadow.configs.recommended, { rules: { "shadow/valid-event-names": "error" } }];
 * ```
 * @since 1.0.0
 * @see docs/rules/valid-event-names.md
 */
export const validEventNames: ShadowRule = defineRule({
  name: "valid-event-names",
  id: "ESL-16",
  type: "problem",
  description: "Require JSX event attributes to name real DOM events and take functions.",
  recommended: true,
  rationale:
    "A misspelled handler (`onClik`) is just an unknown attribute: no listener is attached and nothing " +
    "complains. Handler names are accepted in any casing (`onClick`, `onclick`), and React's capture " +
    "spelling (`onClickCapture`) listens in the capture phase like `oncapture:click`. Handlers must be " +
    "functions: the compiler refuses a string, and `onClick={setCount(1)}` runs at render time and " +
    "passes its result.",
  examples: {
    incorrect: [
      "<button onClik={save}>x</button>",
      '<button onClick="save()">x</button>',
      "const [open, setOpen] = useSignal(false);\nconst view = <button onClick={setOpen(true)}>x</button>;",
      "<input on:Input={update} />",
    ],
    correct: [
      "<button onClick={save}>x</button>",
      "<button oncapture:click={log} onKeyDownCapture={log}>x</button>",
      "<input on:input={update} on:my-custom-event={custom} />",
      "const [open, setOpen] = useSignal(false);\nconst view = <button onClick={() => setOpen(true)}>x</button>;",
    ],
  },
  notes: [
    "Only DOM elements (lower-case tags) are checked; components define their own `onX` props.",
    "`on:` and `oncapture:` accept any event name (custom events), but DOM event names must be lower-case.",
    "React's capture spelling of a known handler (`onClickCapture`) binds the capture phase, as the compiler does; a lower-case `onclickCapture` is reported with a suggestion to use `oncapture:click`.",
    "The list of known handler names mirrors the JSX typings of `@shadow-js/web` (kept in sync by a test).",
  ],
  fixable: "code",
  hasSuggestions: true,
  fix:
    "A DOM event name with capital letters after `on:` or `oncapture:` is fixed to lower case. Suggestions " +
    "rename an unknown `onX` that is within two edits of a known handler, and turn a lower-case " +
    "`onclickCapture` into `oncapture:click`. String handlers and handlers called at render are only " +
    "reported.",
  disableWhen:
    "For a non-standard event a DOM element really fires but the JSX typings do not list yet; prefer " +
    "`on:name`, which accepts any event name, before disabling.",
  messages: {
    unknownEvent: "`{{name}}` is not a DOM event handler. No listener will be attached.",
    didYouMean: "Rename to `{{replacement}}`.",
    captureSuffix:
      "`{{name}}` is React's capture syntax. Use `oncapture:{{event}}` to listen in the capture phase.",
    useCapture: "Use `oncapture:{{event}}`.",
    badCasing: "DOM event names in `{{name}}` must be lower-case: `{{replacement}}`.",
    stringHandler:
      "`{{name}}` is given a string. Event handlers must be functions (`{{name}}={handler}`).",
    calledHandler:
      "`{{name}}` is given the result of a call, which runs while rendering. Pass a function: `{{name}}={() => ...}`.",
  },
  create(context) {
    const model = reactiveModel(context);
    return {
      JSXAttribute(node) {
        const name = jsxAttributeName(node);
        if (name === undefined) return;
        const element = node.parent === null ? null : node.parent;
        const tag = element === null ? undefined : jsxTagName(element);
        if (!isIntrinsicTag(tag)) return;

        const namespaced = /^(on|oncapture):(.+)$/.exec(name);
        const plain = namespaced === null && /^on[A-Za-z]/.test(name);
        if (namespaced === null && !plain) return;

        if (namespaced !== null) {
          const event = namespaced[2] ?? "";
          if (/[A-Z]/.test(event) && DOM_EVENTS.has(event.toLowerCase())) {
            const replacement = `${namespaced[1]}:${event.toLowerCase()}`;
            const nameNode = at(node, "name");
            context.report({
              node,
              messageId: "badCasing",
              data: { name, replacement },
              ...(nameNode === null
                ? {}
                : { fix: (fixer) => fixer.replaceTextRange(nameNode.range, replacement) }),
            });
          }
        } else if (!HANDLER_LOWER.has(name.toLowerCase()) && !isReactCapture(name)) {
          const capture = /^on(.+)Capture$/.exec(name);
          const captured =
            capture === null
              ? undefined
              : HANDLER_LOWER.get(`on${(capture[1] ?? "").toLowerCase()}`);
          const nameNode = at(node, "name");
          if (capture !== null && captured !== undefined) {
            const event = DOM_EVENTS.has(captured)
              ? captured
              : (EVENT_HANDLERS[captured] ?? captured);
            context.report({
              node,
              messageId: "captureSuffix",
              data: { name, event },
              ...(nameNode === null
                ? {}
                : {
                    suggest: [
                      {
                        messageId: "useCapture" as const,
                        data: { event },
                        fix: (fixer) =>
                          fixer.replaceTextRange(nameNode.range, `oncapture:${event}`),
                      },
                    ],
                  }),
            });
          } else {
            const near = closest(name.toLowerCase(), HANDLER_LOWER.keys(), 2);
            const replacement = near === undefined ? undefined : HANDLER_LOWER.get(near);
            const display =
              replacement === undefined
                ? undefined
                : (Object.keys(EVENT_HANDLERS).find((key) => key.toLowerCase() === near) ??
                  replacement);
            context.report({
              node,
              messageId: "unknownEvent",
              data: { name },
              ...(display === undefined || nameNode === null
                ? {}
                : {
                    suggest: [
                      {
                        messageId: "didYouMean" as const,
                        data: { replacement: display },
                        fix: (fixer) => fixer.replaceTextRange(nameNode.range, display),
                      },
                    ],
                  }),
            });
          }
        }

        const expression = jsxAttributeExpression(node);
        if (expression === null) return;
        const value = unwrap(expression);
        const isString =
          (value.type === "Literal" && typeof Reflect.get(value, "value") === "string") ||
          value.type === "TemplateLiteral";
        if (isString) {
          context.report({ node, messageId: "stringHandler", data: { name } });
          return;
        }
        // `setOpen?.(true)` is a ChainExpression around the call; it runs at render just the same.
        const call = value.type === "ChainExpression" ? at(value, "expression") : value;
        if (call !== null && call.type === "CallExpression") {
          const callee = at(call, "callee");
          const write = writeCallOf(context, model, call);
          const calleeName = callee === null ? undefined : identName(callee);
          const consoleObject =
            callee !== null && callee.type === "MemberExpression" ? at(callee, "object") : null;
          const consoleCall =
            consoleObject !== null &&
            identName(consoleObject) === "console" &&
            isGlobalReference(context, consoleObject);
          const globalCall =
            callee !== null &&
            calleeName !== undefined &&
            GLOBAL_CALLS.has(calleeName) &&
            isGlobalReference(context, callee);
          if (write !== null || consoleCall || globalCall) {
            context.report({ node, messageId: "calledHandler", data: { name } });
          }
        }
      },
    };
  },
});
