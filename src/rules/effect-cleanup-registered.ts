import type { Rule } from "eslint";
import { defineRule, type ShadowRule } from "../rule";
import {
  type AstNode,
  at,
  enclosingFunction,
  identName,
  isFunction,
  list,
  str,
  unwrap,
  walk,
} from "../utils/ast";
import { applyEdits, ensureImports } from "../utils/fixes";
import { memberName } from "../utils/reactive";
import { shadowApiName } from "../utils/scope";

const EFFECT_APIS = new Set(["useEffect", "useRenderEffect", "onMount"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);
const RESOURCE_CONSTRUCTORS = new Set([
  "WebSocket",
  "EventSource",
  "ResizeObserver",
  "MutationObserver",
  "IntersectionObserver",
  "PerformanceObserver",
  "BroadcastChannel",
  "Worker",
]);
const RESOURCE_RELEASE = new Set([
  "close",
  "disconnect",
  "terminate",
  "abort",
  "unobserve",
  "dispose",
  "unsubscribe",
]);

type Kind = "listener" | "interval" | "timeout" | "frame" | "subscribe" | "resource";

interface Acquisition {
  node: AstNode;
  kind: Kind;
  /** Names of calls that release it. */
  release: ReadonlySet<string>;
  what: string;
}

const RELEASE: Record<Exclude<Kind, "resource" | "subscribe">, ReadonlySet<string>> = {
  listener: new Set(["removeEventListener"]),
  interval: new Set(["clearInterval"]),
  timeout: new Set(["clearTimeout"]),
  frame: new Set(["cancelAnimationFrame"]),
};

interface Options {
  checkTimeouts?: boolean;
  checkAnimationFrames?: boolean;
}

/** `setInterval` or `window.setInterval`: the called global's name, else `undefined`. */
function globalCallName(call: AstNode): string | undefined {
  const callee = at(call, "callee");
  if (callee === null) return undefined;
  if (callee.type === "Identifier") return identName(callee);
  if (callee.type === "MemberExpression") {
    const object = at(callee, "object");
    // `(window as Window).setInterval` is still the window's method.
    if (object !== null && GLOBAL_OBJECTS.has(identName(unwrap(object)) ?? "")) {
      return memberName(callee);
    }
  }
  return undefined;
}

/** True when addEventListener's options make it self-releasing (`once` or `signal`). */
function listenerReleases(call: AstNode): boolean {
  const options = list(call, "arguments")[2];
  if (options === undefined || options.type !== "ObjectExpression") return false;
  return list(options, "properties").some((property) => {
    const key = identName(at(property, "key"));
    if (key === "signal") return true;
    const value = at(property, "value");
    return key === "once" && value !== null && Reflect.get(unwrap(value), "value") === true;
  });
}

/**
 * Require event listeners, intervals and subscriptions made in an effect to be cleaned up.
 *
 * What it catches and why: an effect re-runs when its sources change and is disposed with its
 * owner, but anything it starts keeps running until a cleanup stops it. Inside the callback of
 * `useEffect`, `useRenderEffect` or `onMount`, the rule looks for `addEventListener(...)`,
 * `setInterval(...)` (also through `window`, `globalThis` or `self`), `.subscribe(...)` and
 * `new WebSocket` / `EventSource` / `ResizeObserver` / `MutationObserver` / `IntersectionObserver` /
 * `PerformanceObserver` / `BroadcastChannel` / `Worker`. Each one must be released by an inline
 * cleanup, that is a function returned from the callback or passed to `onCleanup(...)` that calls
 * the matching release (`removeEventListener`, `clearInterval`, or for the constructed resources
 * `close`, `disconnect`, `terminate`, `abort`, `unobserve`, `dispose` or `unsubscribe`); any
 * inline cleanup counts for a subscription. Otherwise listeners pile up on every re-run and leak
 * after the component is gone. A listener registered with `{ once: true }` or `{ signal }` releases
 * itself, a cleanup that is not written inline (`return stop;`, `onCleanup(stop)`) is trusted, and
 * a nested effect is checked on its own.
 *
 * Incorrect:
 *
 * ```tsx
 * useEffect(() => {
 *   window.addEventListener("resize", onResize);
 * });
 * ```
 *
 * ```tsx
 * onMount(() => {
 *   const id = setInterval(tick, 1000);
 * });
 * ```
 *
 * Correct:
 *
 * ```tsx
 * useEffect(() => {
 *   window.addEventListener("resize", onResize);
 *   onCleanup(() => window.removeEventListener("resize", onResize));
 * });
 * ```
 *
 * ```tsx
 * onMount(() => {
 *   const id = setInterval(tick, 1000);
 *   return () => clearInterval(id);
 * });
 * ```
 *
 * Options: one object.
 * - `checkTimeouts` (boolean, default `false`): also require `setTimeout(...)` to be cleared with
 *   `clearTimeout`.
 * - `checkAnimationFrames` (boolean, default `false`): also require `requestAnimationFrame(...)` to
 *   be canceled with `cancelAnimationFrame`.
 *
 * Autofix: no automatic fix. The suggestion inserts `onCleanup(...)` on the line after the
 * statement that starts the work (and imports `onCleanup` from `@shadow-js/core` when needed):
 * `target.removeEventListener(...)` with the listener's arguments, `clearInterval(id)` /
 * `clearTimeout(id)` / `cancelAnimationFrame(id)` for a timer, `name.close()` for a constructed
 * resource and the subscription itself for `.subscribe()`. It is withheld when the statement is not
 * in a block, when a listener has no `target.` receiver or its handler is not a name or a member,
 * when the work sits in a nested callback (it runs outside the effect) or in a `return` statement
 * (the cleanup would be unreachable), when a timer, resource or subscription is not the initializer
 * of a `const`/`let` declarator, and when the name `onCleanup` is already bound to something else.
 *
 * Disabling: `// eslint-disable-next-line shadow/effect-cleanup-registered` above the line, or a
 * block between `/* eslint-disable shadow/effect-cleanup-registered *\/` and
 * `/* eslint-enable shadow/effect-cleanup-registered *\/`. A disable is legitimate when the work is
 * released by code the rule cannot see (a helper that returns the cleanup and registers it
 * elsewhere), or when it must outlive the owner on purpose.
 *
 * Configs:
 * - `recommended`: `warn`
 * - `strict`: `error` with `{ checkTimeouts: true, checkAnimationFrames: true }`
 * - `migration`: `warn`
 * - `dusk`: `warn`
 *
 * @example
 * ```js
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [
 *   shadow.configs.recommended,
 *   { rules: { "shadow/effect-cleanup-registered": ["error", { checkTimeouts: true }] } },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/effect-cleanup-registered.md
 */
export const effectCleanupRegistered: ShadowRule = defineRule({
  name: "effect-cleanup-registered",
  id: "ESL-05",
  type: "problem",
  description:
    "Require event listeners, intervals and subscriptions made in an effect to be cleaned up.",
  recommended: true,
  rationale:
    "An effect re-runs when its sources change and is disposed with its owner. Anything it starts " +
    "(`addEventListener`, `setInterval`, `.subscribe()`, observers, sockets) keeps running unless a " +
    "cleanup stops it, so listeners pile up on every re-run and leak after the component is gone. " +
    "Register `onCleanup(...)` or return a cleanup function.",
  examples: {
    incorrect: [
      'useEffect(() => {\n  window.addEventListener("resize", onResize);\n});',
      "onMount(() => {\n  const id = setInterval(tick, 1000);\n});",
    ],
    correct: [
      'useEffect(() => {\n  window.addEventListener("resize", onResize);\n  onCleanup(() => window.removeEventListener("resize", onResize));\n});',
      "onMount(() => {\n  const id = setInterval(tick, 1000);\n  return () => clearInterval(id);\n});",
    ],
  },
  notes: [
    "Listeners registered with `{ once: true }` or `{ signal }` release themselves and are not reported.",
    "A cleanup that is not written inline (`return stop;`, `onCleanup(stop)`) is trusted.",
    "Options: `checkTimeouts` (default false) also checks `setTimeout`; `checkAnimationFrames` (default false) checks `requestAnimationFrame`.",
  ],
  fix: "The suggestion inserts `onCleanup(...)` after the statement that starts the work (importing `onCleanup` from `@shadow-js/core` when needed): `removeEventListener` with the listener's arguments, `clearInterval` / `clearTimeout` / `cancelAnimationFrame` of the stored id, `.close()` of a stored resource, or the stored subscription. It is withheld when the statement is not in a block, when the work sits in a nested callback or a `return` statement, when a listener has no receiver or its handler is not a name or member, when the timer, resource or subscription is not the initializer of a variable declarator, or when `onCleanup` is already bound to something else.",
  disableWhen:
    "Disable it when the work is released by code the rule cannot see (a helper that registers the cleanup elsewhere), or when it must outlive the owner on purpose.",
  hasSuggestions: true,
  schema: [
    {
      type: "object",
      properties: {
        checkTimeouts: { type: "boolean" },
        checkAnimationFrames: { type: "boolean" },
      },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{}],
  messages: {
    missingCleanup:
      "`{{what}}` inside `{{api}}` is never released. Register `onCleanup(...)` or return a cleanup function.",
    addCleanup: "Register a cleanup with `onCleanup`.",
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const options: Options =
      typeof rawOptions === "object" && rawOptions !== null ? (rawOptions as Options) : {};
    const keys = context.sourceCode.visitorKeys;
    const text = context.sourceCode.text;

    const acquisitionOf = (node: AstNode): Acquisition | null => {
      if (node.type === "NewExpression") {
        const name = identName(at(node, "callee"));
        if (name !== undefined && RESOURCE_CONSTRUCTORS.has(name)) {
          return { node, kind: "resource", release: RESOURCE_RELEASE, what: `new ${name}()` };
        }
        return null;
      }
      if (node.type !== "CallExpression") return null;
      const callee = at(node, "callee");
      if (callee === null) return null;
      if (callee.type === "MemberExpression") {
        const name = memberName(callee);
        if (name === "addEventListener") {
          if (listenerReleases(node)) return null;
          const type = list(node, "arguments")[0];
          const label =
            type !== undefined && type.type === "Literal" ? `(${text.slice(...type.range)})` : "";
          return {
            node,
            kind: "listener",
            release: RELEASE.listener,
            what: `addEventListener${label}`,
          };
        }
        if (name === "subscribe") {
          return { node, kind: "subscribe", release: new Set(), what: "subscribe()" };
        }
      }
      const global = globalCallName(node);
      if (global === "setInterval") {
        return { node, kind: "interval", release: RELEASE.interval, what: "setInterval()" };
      }
      if (global === "setTimeout" && options.checkTimeouts === true) {
        return { node, kind: "timeout", release: RELEASE.timeout, what: "setTimeout()" };
      }
      if (global === "requestAnimationFrame" && options.checkAnimationFrames === true) {
        return { node, kind: "frame", release: RELEASE.frame, what: "requestAnimationFrame()" };
      }
      if (global === "addEventListener" && !listenerReleases(node)) {
        return { node, kind: "listener", release: RELEASE.listener, what: "addEventListener()" };
      }
      return null;
    };

    /** The function that holds the effect's work. */
    const callbackOf = (call: AstNode, api: string): AstNode | null => {
      // A TypeScript cast around the callback does not change which function it is.
      const args = list(call, "arguments").map(unwrap);
      const first = args[0];
      const second = args[1];
      if (api === "onMount") return first !== undefined && isFunction(first) ? first : null;
      if (second !== undefined && isFunction(second)) return second;
      return first !== undefined && isFunction(first) ? first : null;
    };

    const isNothing = (node: AstNode): boolean => {
      const value = unwrap(node);
      if (value.type === "Identifier") return str(value, "name") === "undefined";
      if (value.type === "Literal") return Reflect.get(value, "value") === null;
      if (value.type === "UnaryExpression") return str(value, "operator") === "void";
      return false;
    };

    /** Reports whether the callback registers cleanups, and collects the inline cleanup bodies. */
    const cleanupsOf = (callback: AstNode): { inline: AstNode[]; opaque: boolean } => {
      const inline: AstNode[] = [];
      let opaque = false;
      const consider = (expression: AstNode): void => {
        const value = unwrap(expression);
        if (isFunction(value)) {
          inline.push(value);
          return;
        }
        if (isNothing(value)) return;
        // `return setInterval(...)` returns a timer id, `return el.addEventListener(...)` returns
        // nothing: neither is a cleanup. A returned `store.subscribe(...)` is (it yields the unsubscribe).
        const started = acquisitionOf(value);
        if (started !== null && started.kind !== "subscribe") return;
        opaque = true;
      };
      const body = at(callback, "body");
      if (body !== null && body.type !== "BlockStatement") consider(body);
      walk(callback, keys, (node) => {
        if (node.type === "CallExpression") {
          const nested = at(node, "callee");
          const nestedApi = nested === null ? null : shadowApiName(context, nested);
          // A nested effect registers its own cleanups; they do not release this effect's work.
          if (nestedApi !== null && EFFECT_APIS.has(nestedApi)) return false;
        }
        if (node.type === "ReturnStatement" && enclosingFunction(node) === callback) {
          const argument = at(node, "argument");
          if (argument !== null) consider(argument);
        } else if (node.type === "CallExpression") {
          const callee = at(node, "callee");
          if (callee !== null && shadowApiName(context, callee) === "onCleanup") {
            const argument = list(node, "arguments")[0];
            if (argument !== undefined) consider(argument);
          }
        }
        return true;
      });
      return { inline, opaque };
    };

    const releases = (
      inline: readonly AstNode[],
      names: ReadonlySet<string>,
      any: boolean,
    ): boolean => {
      for (const fn of inline) {
        if (any) return true;
        let found = false;
        walk(fn, keys, (node) => {
          if (found) return false;
          if (node.type === "CallExpression") {
            const callee = at(node, "callee");
            const name =
              callee === null
                ? undefined
                : callee.type === "Identifier"
                  ? identName(callee)
                  : memberName(callee);
            if (name !== undefined && names.has(name)) found = true;
          }
          return true;
        });
        if (found) return true;
      }
      return false;
    };

    const suggestionFor = (
      acquisition: Acquisition,
      indentOf: (statement: AstNode) => string,
      callback: AstNode,
    ): Rule.SuggestionReportDescriptor | null => {
      const call = acquisition.node;
      // A cleanup must run with the effect's owner, so work inside a nested callback (which runs
      // later, outside the effect) gets no suggestion.
      if (enclosingFunction(call) !== callback) return null;
      // Stop at a return: a statement after it is unreachable, so the cleanup would never register.
      let statement: AstNode | null = call;
      while (
        statement !== null &&
        statement.type !== "ReturnStatement" &&
        statement.parent !== null &&
        statement.parent.type !== "BlockStatement"
      ) {
        statement = statement.parent;
      }
      if (
        statement === null ||
        statement.type === "ReturnStatement" ||
        statement.parent === null ||
        isFunction(statement)
      ) {
        return null;
      }
      let cleanup: string | null = null;
      if (acquisition.kind === "listener") {
        const callee = at(call, "callee");
        const args = list(call, "arguments");
        const [type, handler, flags] = args;
        if (
          callee === null ||
          callee.type !== "MemberExpression" ||
          type === undefined ||
          handler === undefined ||
          (handler.type !== "Identifier" && handler.type !== "MemberExpression")
        ) {
          return null;
        }
        const target = at(callee, "object");
        if (target === null) return null;
        const extra = flags === undefined ? "" : `, ${text.slice(...flags.range)}`;
        cleanup = `${text.slice(...target.range)}.removeEventListener(${text.slice(...type.range)}, ${text.slice(...handler.range)}${extra})`;
        cleanup = `() => ${cleanup}`;
      } else {
        // The name must be the one that holds this call's result, not a sibling declarator's.
        const declaration = statement.type === "VariableDeclaration" ? statement : null;
        const declarator =
          declaration === null
            ? undefined
            : list(declaration, "declarations").find((candidate) => {
                const init = at(candidate, "init");
                return init !== null && unwrap(init) === call;
              });
        const id = declarator === undefined ? null : at(declarator, "id");
        const name = id === null ? undefined : identName(id);
        if (name === undefined) return null;
        if (acquisition.kind === "interval") cleanup = `() => clearInterval(${name})`;
        else if (acquisition.kind === "timeout") cleanup = `() => clearTimeout(${name})`;
        else if (acquisition.kind === "frame") cleanup = `() => cancelAnimationFrame(${name})`;
        else if (acquisition.kind === "subscribe") cleanup = name;
        else cleanup = `() => ${name}.close()`;
      }
      if (cleanup === null) return null;
      const insertAt = statement.range[1];
      const line = `onCleanup(${cleanup});`;
      const statementNode = statement;
      const imports = ensureImports(context, [{ name: "onCleanup", source: "@shadow-js/core" }]);
      if (imports === null) return null;
      return {
        messageId: "addCleanup",
        fix: (fixer) => [
          ...applyEdits(fixer, imports),
          fixer.insertTextAfterRange([insertAt, insertAt], `\n${indentOf(statementNode)}${line}`),
        ],
      };
    };

    const indentOf = (statement: AstNode): string => {
      const lineStart = text.lastIndexOf("\n", statement.range[0] - 1) + 1;
      const prefix = text.slice(lineStart, statement.range[0]);
      return /^\s*$/.test(prefix) ? prefix : "";
    };

    return {
      CallExpression(node: AstNode) {
        const callee = at(node, "callee");
        if (callee === null) return;
        const api = shadowApiName(context, callee);
        if (api === null || !EFFECT_APIS.has(api)) return;
        const callback = callbackOf(node, api);
        if (callback === null) return;

        const acquisitions: Acquisition[] = [];
        walk(callback, keys, (current) => {
          if (current !== callback && current.type === "CallExpression") {
            const nested = at(current, "callee");
            const nestedApi = nested === null ? null : shadowApiName(context, nested);
            // A nested effect is checked on its own.
            if (nestedApi !== null && EFFECT_APIS.has(nestedApi)) return false;
          }
          const found = acquisitionOf(current);
          if (found !== null) acquisitions.push(found);
          return true;
        });
        if (acquisitions.length === 0) return;

        const { inline, opaque } = cleanupsOf(callback);
        for (const acquisition of acquisitions) {
          if (opaque) continue;
          if (releases(inline, acquisition.release, acquisition.kind === "subscribe")) continue;
          const suggestion = suggestionFor(acquisition, indentOf, callback);
          context.report({
            node: acquisition.node,
            messageId: "missingCleanup",
            data: { what: acquisition.what, api },
            ...(suggestion === null ? {} : { suggest: [suggestion] }),
          });
        }
      },
    };
  },
});
