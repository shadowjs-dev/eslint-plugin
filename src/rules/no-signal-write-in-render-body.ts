import { defineRule, type ShadowRule } from "../rule";
import { type AstNode, isNode } from "../utils/ast";
import { functionName, isComponent } from "../utils/components";
import { owningFunction } from "../utils/flow";
import { reactiveModel, writeCallOf } from "../utils/reactive";

/**
 * Disallow writing external signals or stores while a component renders.
 *
 * What it catches and why: a ShadowJS component body runs once, to build its DOM; it is not a
 * render function that runs again on every change. Forgiving reactivity keeps the values in the
 * body live (derived constants become memos, the forgiving-reactivity contract), so a write in the
 * body is not needed to keep the view current. Writing a signal or store that lives outside the
 * component from that body is a side effect of mounting: it notifies readers while the tree is
 * still being created and can loop. The rule reports a call of a tracked setter (from `useSignal`
 * or `useStore`, through aliases) or of `writeSignal` made while a component (a PascalCase
 * function that contains JSX) runs, including callbacks that run immediately (immediately invoked
 * functions, `batch`, `untrack`, array iteration). A setter of a signal declared inside the
 * component (in its body or in one of its blocks) is not reported: seeding your own state is
 * initialization. Event handlers, effects, `onMount` and timers run later and are not checked;
 * nor is module-level code.
 *
 * Incorrect:
 *
 * ```tsx
 * const [visited, setVisited] = useSignal(false);
 * function Page() {
 *   setVisited(true);
 *   return <p>Hi</p>;
 * }
 * ```
 *
 * Correct:
 *
 * ```tsx
 * const [visited, setVisited] = useSignal(false);
 * function Page() {
 *   onMount(() => setVisited(true));
 *   return <p>Hi</p>;
 * }
 * ```
 *
 * ```tsx
 * function Counter() {
 *   const [count, setCount] = useSignal(0);
 *   return <button onClick={() => setCount(count() + 1)}>{count}</button>;
 * }
 * ```
 *
 * Options: this rule has no options.
 *
 * Autofix: the rule does not fix code.
 *
 * Disabling: `// eslint-disable-next-line shadow/no-signal-write-in-render-body` for one line, or
 * a block between these comments:
 *
 * ```ts
 * /* eslint-disable shadow/no-signal-write-in-render-body *\/
 * /* eslint-enable shadow/no-signal-write-in-render-body *\/
 * ```
 *
 * A disable is legitimate when the write is a deliberate one-time registration that must happen
 * while the component is created, such as a component announcing that it mounted to a shared
 * store before its children read it.
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
 *   { rules: { "shadow/no-signal-write-in-render-body": "error" } },
 * ];
 * ```
 * @since 1.0.0
 * @see docs/rules/no-signal-write-in-render-body.md
 */
export const noSignalWriteInRenderBody: ShadowRule = defineRule({
  name: "no-signal-write-in-render-body",
  id: "ESL-04",
  type: "problem",
  description: "Disallow writing external signals or stores while a component renders.",
  recommended: true,
  rationale:
    "A component body runs once to build its DOM. Writing a signal that lives outside the component from " +
    "that body re-notifies readers while they are still being created, produces different output on the " +
    "server and the client, and can loop. Initialize state with the value you want, write from an event " +
    "handler, or move the write into `onMount` / `useEffect`.",
  examples: {
    incorrect: [
      "const [visited, setVisited] = useSignal(false);\nfunction Page() {\n  setVisited(true);\n  return <p>Hi</p>;\n}",
    ],
    correct: [
      "const [visited, setVisited] = useSignal(false);\nfunction Page() {\n  onMount(() => setVisited(true));\n  return <p>Hi</p>;\n}",
      "function Counter() {\n  const [count, setCount] = useSignal(0);\n  return <button onClick={() => setCount(count() + 1)}>{count}</button>;\n}",
    ],
  },
  notes: [
    "Signals created in the same component are not reported: seeding your own state is harmless.",
    "Callbacks that run immediately (IIFEs, `batch`, `untrack`, `array.map`) count as part of the render body; event handlers and effects do not.",
  ],
  disableWhen:
    "When the write is a deliberate one-time registration that must happen while the component is " +
    "created, such as announcing to a shared store that it mounted before its children read it.",
  messages: {
    writeInRender:
      "`{{name}}` writes state while `{{component}}` renders. Write from an event handler, `onMount` or `useEffect` instead.",
  },
  create(context) {
    const model = reactiveModel(context);
    const keys = context.sourceCode.visitorKeys;
    /** True when `node` is `outer` or sits somewhere inside it. */
    const declaredWithin = (node: AstNode, outer: AstNode): boolean => {
      let current: AstNode | null = node;
      while (current !== null) {
        if (current === outer) return true;
        current = current.parent;
      }
      return false;
    };
    return {
      CallExpression(node) {
        const write = writeCallOf(context, model, node);
        if (write === null) return;
        const { fn } = owningFunction(context, node);
        if (fn === null || !isComponent(fn, keys)) return;
        // Writing a signal declared inside this component (in its body or one of its blocks) is
        // initialization, not a side effect.
        const owner: unknown = write.setter?.scope.block;
        if (isNode(owner) && declaredWithin(owner, fn)) return;
        const label = functionName(fn) ?? "the component";
        context.report({
          node,
          messageId: "writeInRender",
          data: { name: write.name, component: label },
        });
      },
    };
  },
});
