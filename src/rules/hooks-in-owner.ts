import { defineRule, type ShadowRule } from "../rule";
import {
  type AstNode,
  at,
  identName,
  isFunction,
  isWrapper,
  list,
  someInFunction,
  unwrap,
} from "../utils/ast";
import { functionName, isComponent, isHookName } from "../utils/components";
import { owningFunction } from "../utils/flow";
import { memberName } from "../utils/reactive";
import { shadowApiName } from "../utils/scope";

/** Hooks that attach to the current owner: without one they warn, throw or never clean up. */
const OWNER_REQUIRED = new Set([
  "useEffect",
  "useRenderEffect",
  "onMount",
  "onCleanup",
  "onError",
  "useId",
  "useContext",
  "useResource",
  "useSelector",
  "useOptimistic",
]);
/** Framework hooks that work anywhere but still belong in a stable place. */
const FREE_HOOKS = new Set(["useSignal", "useStore", "useMemo"]);
const LOOPS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);
const DEFERRED_RECEIVERS = new Set([
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
]);
const DEFERRED_METHODS = new Set(["then", "catch", "finally", "addEventListener"]);
const HANDLER_NAME = /^(?:handle|on)[A-Z]/;

interface Options {
  additionalHooks?: string[];
  conditional?: boolean;
}

/**
 * Require `use*` hooks to be created in a component or hook, not in loops, after early returns, or
 * later.
 *
 * What it catches and why: hooks such as `useEffect`, `onCleanup` and `useResource` attach to the
 * owner that is current while a component or hook runs. The rule reports:
 * - a hook inside a loop, or inside an array-iteration callback such as `.map(...)`: each iteration
 *   creates another owner-bound computation (use `<For>` for per-item state);
 * - a hook after an early `return` in a component or custom hook: it is silently skipped for the
 *   branch that returned;
 * - an owner-bound hook (`useEffect`, `useRenderEffect`, `onMount`, `onCleanup`, `onError`, `useId`,
 *   `useContext`, `useResource`, `useSelector`, `useOptimistic`) at module scope: it has no owner
 *   and is never disposed;
 * - an owner-bound hook or any `use*` call inside a callback that runs later: an `on*` JSX handler,
 *   a `setTimeout` / `setInterval` / `queueMicrotask` / `requestAnimationFrame` /
 *   `requestIdleCallback` callback, a `.then` / `.catch` / `.finally` / `.addEventListener`
 *   callback, or a function named `handleX` / `onX`.
 *
 * `useSignal`, `useStore` and `useMemo` work without an owner, so only loops and early returns are
 * reported for them. A component is a PascalCase function that contains JSX; a custom hook is a
 * function whose name is `use` followed by an uppercase letter or a digit. Functions that run right
 * away (an IIFE, or a callback of `batch`, `untrack`, `runWithOwner`, `flushSync` or `catchError`)
 * are looked through.
 *
 * Incorrect:
 *
 * ```tsx
 * useEffect(() => track());
 * ```
 *
 * ```tsx
 * function Page(props) {
 *   if (props.disabled) return <p />;
 *   const [n] = useSignal(0);
 *   return <b>{n}</b>;
 * }
 * ```
 *
 * ```tsx
 * function List(props) {
 *   for (const item of props.items) useEffect(() => log(item));
 *   return <ul />;
 * }
 * ```
 *
 * ```tsx
 * function Page() {
 *   return <button onClick={() => useEffect(run)} />;
 * }
 * ```
 *
 * Correct:
 *
 * ```tsx
 * function Page() {
 *   useEffect(() => track());
 *   return <p />;
 * }
 * ```
 *
 * ```tsx
 * function useTimer() {
 *   onCleanup(stop);
 * }
 * ```
 *
 * ```tsx
 * function Page(props) {
 *   const [n] = useSignal(0);
 *   return <Show when={!props.disabled}><b>{n}</b></Show>;
 * }
 * ```
 *
 * Options: one object.
 * - `conditional` (boolean, default `false`): also report hooks inside `if`, `?:`, the right side
 *   of `&&` / `||` / `??`, and `switch` cases of a component or hook.
 * - `additionalHooks` (string array, default none): extra hook names, matched exactly, that must
 *   follow the same rules as the owner-bound hooks.
 *
 * Autofix: the rule does not fix code.
 *
 * Disabling: `// eslint-disable-next-line shadow/hooks-in-owner` above the line, or a block between
 * `/* eslint-disable shadow/hooks-in-owner *\/` and `/* eslint-enable shadow/hooks-in-owner *\/`.
 * A disable is legitimate when the code supplies an owner the rule cannot see, for example a
 * callback run inside `createRoot` or `runWithOwner` through a helper.
 *
 * Configs:
 * - `recommended`: `warn`
 * - `strict`: `error` with `{ conditional: true }`
 * - `migration`: `warn`
 * - `dusk`: `warn`
 *
 * @example
 * ```js
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [
 *   shadow.configs.recommended,
 *   { rules: { "shadow/hooks-in-owner": ["error", { additionalHooks: ["useTracker"] }] } },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/hooks-in-owner.md
 */
export const hooksInOwner: ShadowRule = defineRule({
  name: "hooks-in-owner",
  id: "ESL-07",
  type: "problem",
  description:
    "Require `use*` hooks to be created in a component or hook, not in loops, after early returns, or later.",
  recommended: true,
  rationale:
    "Hooks such as `useEffect`, `onCleanup` and `useResource` attach to the owner that is current while a " +
    "component or hook runs. Called at module level, from an event handler or a timer, they have no owner " +
    "and are never disposed. Called in a loop they create unbounded computations, and called after an " +
    "early `return` they are silently skipped for the branch that returned. Keep hooks at the top level " +
    "of components and custom hooks, and use `<For>` for per-item state.",
  examples: {
    incorrect: [
      "useEffect(() => track());",
      "function Page(props) {\n  if (props.disabled) return <p />;\n  const [n] = useSignal(0);\n  return <b>{n}</b>;\n}",
      "function List(props) {\n  for (const item of props.items) useEffect(() => log(item));\n  return <ul />;\n}",
      "function Page() {\n  return <button onClick={() => useEffect(run)} />;\n}",
    ],
    correct: [
      "function Page() {\n  useEffect(() => track());\n  return <p />;\n}",
      "function useTimer() {\n  onCleanup(stop);\n}",
      "function Page(props) {\n  const [n] = useSignal(0);\n  return <Show when={!props.disabled}><b>{n}</b></Show>;\n}",
    ],
  },
  notes: [
    "`useSignal`, `useStore` and `useMemo` work without an owner, so only loops and early returns are reported for them.",
    "Option `conditional: true` (used by the strict config) also reports hooks inside `if`, `?:`, `&&` and `switch`.",
    "Option `additionalHooks` lists extra hook names (strings, matched exactly) that must follow the same rules.",
  ],
  disableWhen:
    "Disable it when the code supplies an owner the rule cannot see, for example a callback that a helper runs inside `createRoot` or `runWithOwner`.",
  schema: [
    {
      type: "object",
      properties: {
        additionalHooks: { type: "array", items: { type: "string" } },
        conditional: { type: "boolean" },
      },
      additionalProperties: false,
    },
  ],
  defaultOptions: [{}],
  messages: {
    inLoop:
      "`{{name}}` is called inside a loop. Each iteration creates another owner-bound computation; use `<For>` / `<Index>` for per-item state, or move the hook out of the loop.",
    afterEarlyReturn:
      "`{{name}}` is called after an early return, so it is skipped for the branch that returned. Move it above the return, or use `<Show>`.",
    outsideOwner:
      "`{{name}}` needs an owner but runs {{where}}. Call it from a component or custom hook, or wrap the work in `createRoot` / `runWithOwner`.",
    conditional:
      "`{{name}}` is called conditionally. Create hooks unconditionally at the top level of the component or hook, and put the condition inside.",
  },
  create(context) {
    const rawOptions: unknown = context.options[0];
    const options: Options =
      typeof rawOptions === "object" && rawOptions !== null ? (rawOptions as Options) : {};
    const extra = new Set(options.additionalHooks ?? []);
    const keys = context.sourceCode.visitorKeys;

    /** The hook name a call refers to, or `null` when the call is not a hook. */
    const hookName = (call: AstNode): string | null => {
      const callee = at(call, "callee");
      if (callee === null) return null;
      // `(useEffect as Hook)(...)` is still a call of the hook.
      const target = unwrap(callee);
      const api = shadowApiName(context, target);
      if (api !== null && (OWNER_REQUIRED.has(api) || FREE_HOOKS.has(api))) return api;
      if (target.type !== "Identifier") return null;
      const name = identName(target);
      if (name === undefined) return null;
      return isHookName(name) || extra.has(name) ? name : null;
    };

    const isDeferred = (fn: AstNode): boolean => {
      // A TypeScript cast around the function (`(() => ...) as Handler`) does not change its role.
      let child: AstNode = fn;
      let parent = fn.parent;
      while (parent !== null && isWrapper(parent)) {
        child = parent;
        parent = parent.parent;
      }
      if (parent === null) return false;
      if (parent.type === "JSXExpressionContainer") {
        const attribute = parent.parent;
        if (attribute !== null && attribute.type === "JSXAttribute") {
          const name = identName(at(attribute, "name"));
          return name !== undefined && /^on[A-Za-z]/.test(name);
        }
        return false;
      }
      if (parent.type === "CallExpression") {
        const callee = at(parent, "callee");
        if (callee === null || !list(parent, "arguments").includes(child)) return false;
        if (callee.type === "Identifier") return DEFERRED_RECEIVERS.has(identName(callee) ?? "");
        if (callee.type === "MemberExpression") {
          return DEFERRED_METHODS.has(memberName(callee) ?? "");
        }
        return false;
      }
      const name = functionName(fn);
      return name !== undefined && HANDLER_NAME.test(name);
    };

    const inLoop = (node: AstNode, boundary: AstNode | null): boolean => {
      let current = node.parent;
      while (current !== null && current !== boundary) {
        if (LOOPS.has(current.type)) return true;
        current = current.parent;
      }
      return false;
    };

    const afterEarlyReturn = (node: AstNode, fn: AstNode): boolean => {
      let current: AstNode = node;
      while (current !== fn) {
        const parent: AstNode | null = current.parent;
        if (parent === null) return false;
        if (parent.type === "BlockStatement" || parent.type === "SwitchCase") {
          const siblings = list(parent, parent.type === "SwitchCase" ? "consequent" : "body");
          const index = siblings.indexOf(current);
          for (let i = 0; i < index; i += 1) {
            const sibling = siblings[i];
            if (sibling === undefined || isFunction(sibling) || sibling.type === "ClassDeclaration")
              continue;
            if (
              someInFunction(sibling, keys, (candidate) => candidate.type === "ReturnStatement")
            ) {
              return true;
            }
          }
        }
        current = parent;
      }
      return false;
    };

    const isConditional = (node: AstNode, fn: AstNode): boolean => {
      let child: AstNode = node;
      let parent = node.parent;
      while (parent !== null && child !== fn) {
        if (parent.type === "IfStatement" && at(parent, "test") !== child) return true;
        if (parent.type === "ConditionalExpression" && at(parent, "test") !== child) return true;
        if (parent.type === "LogicalExpression" && at(parent, "right") === child) return true;
        if (parent.type === "SwitchCase") return true;
        child = parent;
        parent = parent.parent;
      }
      return false;
    };

    return {
      CallExpression(node) {
        const name = hookName(node);
        if (name === null) return;
        const owning = owningFunction(context, node);
        const fn = owning.fn;
        if (owning.viaIteration || inLoop(node, fn)) {
          context.report({ node, messageId: "inLoop", data: { name } });
          return;
        }
        if (fn === null) {
          if (OWNER_REQUIRED.has(name) || extra.has(name)) {
            context.report({
              node,
              messageId: "outsideOwner",
              data: { name, where: "at module scope" },
            });
          }
          return;
        }
        const fnName = functionName(fn);
        const isHookFn = fnName !== undefined && isHookName(fnName);
        if (isComponent(fn, keys) || isHookFn) {
          if (afterEarlyReturn(node, fn)) {
            context.report({ node, messageId: "afterEarlyReturn", data: { name } });
            return;
          }
          if (options.conditional === true && isConditional(node, fn)) {
            context.report({ node, messageId: "conditional", data: { name } });
          }
          return;
        }
        if (isDeferred(fn) && (OWNER_REQUIRED.has(name) || extra.has(name) || isHookName(name))) {
          const label =
            fnName === undefined
              ? "inside a callback that runs later"
              : `inside \`${fnName}\`, which runs later`;
          context.report({ node, messageId: "outsideOwner", data: { name, where: label } });
        }
      },
    };
  },
});
