import { hooksInOwner } from "../../src/rules/hooks-in-owner";
import { runRule } from "../support/tester";

const imp =
  'import { useEffect, onMount, onCleanup, useSignal, useMemo, useResource, useContext, createRoot } from "@shadow-js/core";\n';

runRule("ESL-07", "hooks-in-owner", hooksInOwner, {
  valid: [
    `${imp}function Page() { useEffect(() => track()); const [n] = useSignal(0); return <b>{n}</b>; }`,
    `${imp}const Page = () => { onMount(() => start()); return <p />; };`,
    // Custom hooks may use owner-bound hooks.
    `${imp}function useTimer() { onCleanup(stop); const [t] = useSignal(0); return t; }`,
    // useSignal / useStore / useMemo work at module scope.
    `${imp}const [theme, setTheme] = useSignal("light");\nconst doubled = useMemo(() => theme());`,
    // createRoot gives module-level code an owner.
    `${imp}createRoot(() => { useEffect(() => track()); });`,
    // Hooks inside effect callbacks (nested effects) are fine.
    `${imp}function Page() { useEffect(() => { useEffect(() => inner()); }); return <p />; }`,
    // Early return after all hooks.
    `${imp}function Page(props: { off: boolean }) { const [n] = useSignal(0); if (props.off) return <p />; return <b>{n}</b>; }`,
    // Functions declared before the return do not count as returns.
    `${imp}function Page() { function helper() { return 1; } const [n] = useSignal(helper()); return <b>{n}</b>; }`,
    // Conditional hooks are allowed unless the option is on.
    `${imp}function Page(props: { a: boolean }) { if (props.a) { useEffect(() => run()); } return <p />; }`,
    // Callback of an iteration that is not creating hooks.
    `${imp}function Page(props: { items: number[] }) { const out = props.items.map((x) => x + 1); return <p>{out}</p>; }`,
    // Event handler that does not call hooks.
    `${imp}function Page() { return <button onClick={() => setN(1)} />; }`,
    // Lowercase helper without deferral keywords may call hooks (called inside components).
    `${imp}function setupAnalytics() { onCleanup(stop); }`,
    // [ESL-07.E1] An IIFE behind a TypeScript cast runs at the component's render: its hooks are owned.
    `${imp}function Page() { ((() => { const [n] = useSignal(0); return n; }) as () => number)(); return <p />; }`,
    // use-named non-hook identifier (member call) is ignored.
    `${imp}function Page() { api.useThing(); return <p />; }`,
    // Module scope call to a custom hook is not judged.
    "const value = useCustom();",
    // Switch inside component is fine without the option.
    `${imp}function Page(props: { k: number }) { switch (props.k) { case 1: useEffect(() => a()); break; } return <p />; }`,
    // Edge cases: a return inside a nested callback is not an early return of the component.
    `${imp}function Page() { items.forEach((x) => { if (!x) return; }); const [n] = useSignal(0); return <b>{n}</b>; }`,
    // Edge cases: a comment between the early return and the hook does not change the rule.
    `${imp}function Page(props: { off: boolean }) {\n  // hooks first\n  const [n] = useSignal(0);\n  if (props.off) return <p />; // bail out\n  return <b>{n}</b>;\n}`,
  ],
  invalid: [
    {
      name: "effect at module scope",
      code: `${imp}useEffect(() => track());`,
      errors: [
        { messageId: "outsideOwner", data: { name: "useEffect", where: "at module scope" } },
      ],
    },
    {
      name: "onCleanup, useResource at module scope",
      code: `${imp}onCleanup(() => stop());\nconst r = useResource(() => load());`,
      errors: [{ messageId: "outsideOwner" }, { messageId: "outsideOwner" }],
    },
    {
      name: "after an early return",
      code: `${imp}function Page(props: { off: boolean }) { if (props.off) return <p />; const [n] = useSignal(0); return <b>{n}</b>; }`,
      errors: [{ messageId: "afterEarlyReturn", data: { name: "useSignal" } }],
    },
    {
      name: "after a nested early return",
      code: `${imp}function Page(props: { off: boolean }) {\n  if (props.off) {\n    return <p />;\n  }\n  useEffect(() => run());\n  return <b />;\n}`,
      errors: [{ messageId: "afterEarlyReturn" }],
    },
    {
      name: "inside a hook after an early return",
      code: `${imp}function useThing(x: boolean) { if (!x) return; onCleanup(stop); }`,
      errors: [{ messageId: "afterEarlyReturn" }],
    },
    {
      name: "in a for loop",
      code: `${imp}function List(props: { items: string[] }) { for (const item of props.items) { useEffect(() => log(item)); } return <ul />; }`,
      errors: [{ messageId: "inLoop", data: { name: "useEffect" } }],
    },
    {
      name: "in a while loop",
      code: `${imp}function List() { let i = 0; while (i < 3) { useSignal(i); i += 1; } return <ul />; }`,
      errors: [{ messageId: "inLoop" }],
    },
    {
      name: "in an array iteration callback",
      code: `${imp}function List(props: { items: string[] }) { props.items.forEach((item) => { useSignal(item); }); return <ul />; }`,
      errors: [{ messageId: "inLoop" }],
    },
    // [ESL-07.E3] A component wrapped in a TypeScript cast is still a component for the runtime: the
    // rule judges its hooks as a component does (the compiler skips it; see ESL-01.E11).
    {
      name: "component wrapped in a cast: hook after an early return",
      code: `${imp}const Page = ((props: { off: boolean }) => { if (props.off) return <p />; const [n] = useSignal(0); return <b>{n}</b>; }) as FC;`,
      errors: [{ messageId: "afterEarlyReturn", data: { name: "useSignal" } }],
    },
    // [ESL-07.E2] The iteration callback behind a TypeScript cast is still an iteration callback.
    {
      name: "hook in an iteration callback behind a cast",
      code: `${imp}function List(props: { items: string[] }) { props.items.forEach(((item: string) => { useSignal(item); }) as (item: string) => void); return <ul />; }`,
      errors: [{ messageId: "inLoop" }],
    },
    {
      name: "loop at module scope",
      code: `${imp}for (let i = 0; i < 3; i += 1) { useMemo(() => i); }`,
      errors: [{ messageId: "inLoop", data: { name: "useMemo" } }],
    },
    {
      name: "event handler JSX attribute",
      code: `${imp}function Page() { return <button onClick={() => useEffect(run)} />; }`,
      errors: [
        {
          messageId: "outsideOwner",
          data: { name: "useEffect", where: "inside a callback that runs later" },
        },
      ],
    },
    {
      name: "timer callback",
      code: `${imp}function Page() { setTimeout(() => { onCleanup(stop); }, 10); return <p />; }`,
      errors: [{ messageId: "outsideOwner" }],
    },
    {
      name: "promise callback",
      code: `${imp}function Page() { load().then(() => { useContext(Ctx); }); return <p />; }`,
      errors: [{ messageId: "outsideOwner" }],
    },
    {
      name: "handler function named handleX",
      code: `${imp}function handleClick() { useEffect(run); }`,
      errors: [
        {
          messageId: "outsideOwner",
          data: { name: "useEffect", where: "inside `handleClick`, which runs later" },
        },
      ],
    },
    {
      name: "custom hook in a loop",
      code: `${imp}function Page() { for (const x of xs) { useCustom(x); } return <p />; }`,
      errors: [{ messageId: "inLoop", data: { name: "useCustom" } }],
    },
    {
      name: "conditional hooks when enabled",
      code: `${imp}function Page(props: { a: boolean }) { if (props.a) { useEffect(() => run()); } const x = props.a ? useSignal(1) : null; const y = props.a && useSignal(2); return <p />; }`,
      options: [{ conditional: true }],
      errors: [
        { messageId: "conditional", data: { name: "useEffect" } },
        { messageId: "conditional", data: { name: "useSignal" } },
        { messageId: "conditional", data: { name: "useSignal" } },
      ],
    },
    {
      name: "additionalHooks are owner-required at module scope",
      code: "createSomething();",
      options: [{ additionalHooks: ["createSomething"] }],
      errors: [
        { messageId: "outsideOwner", data: { name: "createSomething", where: "at module scope" } },
      ],
    },
    {
      name: "switch case with the conditional option",
      code: `${imp}function Page(props: { k: number }) { switch (props.k) { case 1: useEffect(() => a()); break; } return <p />; }`,
      options: [{ conditional: true }],
      errors: [{ messageId: "conditional" }],
    },
    // Edge cases: a TypeScript cast around a callback that runs later is still that callback.
    {
      name: "cast around a timer callback",
      code: `${imp}function Page() { setTimeout((() => { onCleanup(stop); }) as () => void, 10); return <p />; }`,
      errors: [
        {
          messageId: "outsideOwner",
          data: { name: "onCleanup", where: "inside a callback that runs later" },
        },
      ],
    },
    // Edge cases: a cast around an event handler attribute value is still the handler.
    {
      name: "cast around an event handler attribute",
      code: `${imp}function Page() { return <button onClick={(() => useEffect(run)) satisfies () => void} />; }`,
      errors: [
        {
          messageId: "outsideOwner",
          data: { name: "useEffect", where: "inside a callback that runs later" },
        },
      ],
    },
    // Edge cases: a handler written as an object property in a JSX spread is still a handler.
    {
      name: "handler in a JSX spread object",
      code: `${imp}function Page() { return <button {...{ onClick: () => useEffect(run) }} />; }`,
      errors: [
        {
          messageId: "outsideOwner",
          data: { name: "useEffect", where: "inside `onClick`, which runs later" },
        },
      ],
    },
    // Edge cases: a cast on the hook itself does not hide it at module scope.
    {
      name: "cast on the hook callee",
      code: `${imp}const value = (useEffect as Hook)(() => track());`,
      errors: [
        { messageId: "outsideOwner", data: { name: "useEffect", where: "at module scope" } },
      ],
    },
    // Edge cases: a hook after an early return in an arrow component with a comment on the return.
    {
      name: "after an early return with a comment",
      code: `${imp}const Page = (props: { off: boolean }) => {\n  if (props.off) return <p />; // nothing to show\n  const [n] = useSignal(0);\n  return <b>{n}</b>;\n};`,
      errors: [{ messageId: "afterEarlyReturn", data: { name: "useSignal" } }],
    },
  ],
});
