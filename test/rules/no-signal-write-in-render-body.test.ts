import { noSignalWriteInRenderBody } from "../../src/rules/no-signal-write-in-render-body";
import { runRule } from "../support/tester";

const core = 'import { useSignal, useEffect, onMount, batch } from "@shadow-js/core";\n';
const outer = `${core}const [visited, setVisited] = useSignal(false);\n`;

runRule("ESL-04", "no-signal-write-in-render-body", noSignalWriteInRenderBody, {
  valid: [
    `${outer}function Page() { onMount(() => setVisited(true)); return <p>Hi</p>; }`,
    `${outer}function Page() { useEffect(() => { setVisited(true); }); return <p>Hi</p>; }`,
    `${outer}function Page() { return <button onClick={() => setVisited(true)}>x</button>; }`,
    // Own state, seeded in the body.
    `${core}function Counter() { const [n, setN] = useSignal(0); setN(5); return <b>{n}</b>; }`,
    // Not a component (no JSX): helper functions may write.
    `${outer}function markVisited() { setVisited(true); }`,
    // Lowercase function that renders JSX is not a component.
    `${outer}function render() { setVisited(true); return <p />; }`,
    // Event handler function declared inside the component.
    `${outer}function Page() { function handle() { setVisited(true); } return <button onClick={handle} />; }`,
    // Timer callbacks run later.
    `${outer}function Page() { setTimeout(() => setVisited(true), 0); return <p />; }`,
    // Other libraries' setters are not tracked.
    "function Page() { setThing(1); return <p />; }",
    // Module level writes are application code, not render.
    `${outer}setVisited(true);`,
    // Edge cases: a handler written as a prop object in a spread is an event handler, not render.
    `${outer}function Page() { return <button {...{ onClick: () => setVisited(true) }} />; }`,
    // Edge cases: a signal the component declares inside one of its own blocks is still its state.
    `${core}function Page(props: { on: boolean }) { if (props.on) { const [n, setN] = useSignal(0); setN(1); return <b>{n}</b>; } return <p />; }`,
  ],
  invalid: [
    {
      name: "write in a function component",
      code: `${outer}function Page() { setVisited(true); return <p>Hi</p>; }`,
      errors: [{ messageId: "writeInRender", data: { name: "setVisited", component: "Page" } }],
    },
    {
      name: "arrow component",
      code: `${outer}const Page = () => { setVisited(true); return <p>Hi</p>; };`,
      errors: [{ messageId: "writeInRender" }],
    },
    {
      name: "inside batch and array iteration at setup time",
      code: `${outer}function Page() { batch(() => { setVisited(true); }); [1].forEach(() => setVisited(false)); return <p />; }`,
      errors: [{ messageId: "writeInRender" }, { messageId: "writeInRender" }],
    },
    {
      name: "setter from props-like parameter alias",
      code: `${outer}const set = setVisited;\nfunction Page() { set(true); return <p />; }`,
      errors: [{ messageId: "writeInRender", data: { name: "set", component: "Page" } }],
    },
    {
      name: "store setter",
      code: `${core}import { useStore } from "@shadow-js/core/store";\nconst [s, setS] = useStore({ n: 0 });\nfunction Page() { setS((d) => { d.n = 1; }); return <p />; }`,
      errors: [{ messageId: "writeInRender" }],
    },
    {
      name: "conditional write is still render-time",
      code: `${outer}function Page(props: { v: boolean }) { if (props.v) setVisited(true); return <p />; }`,
      errors: [{ messageId: "writeInRender" }],
    },
    // [ESL-04.E1] A cast around a synchronous callback does not hide the write from the render.
    {
      name: "write in an IIFE behind a cast in the component body",
      code: `${outer}function Page() { ((() => setVisited(true)) as () => void)(); return <p />; }`,
      errors: [{ messageId: "writeInRender", data: { name: "setVisited", component: "Page" } }],
    },
    {
      name: "write in an iteration callback behind a cast",
      code: `${outer}function Page(props: { items: number[] }) { props.items.forEach(((i: number) => setVisited(i > 0)) as (i: number) => void); return <p />; }`,
      errors: [{ messageId: "writeInRender", data: { name: "setVisited", component: "Page" } }],
    },
    {
      name: "write in a runner callback behind a non-null assertion",
      code: `${outer}function Page() { batch((() => setVisited(true))!); return <p />; }`,
      errors: [{ messageId: "writeInRender", data: { name: "setVisited", component: "Page" } }],
    },
    // Edge cases: a TypeScript cast on the component keeps it a component.
    {
      name: "component wrapped in a cast",
      code: `${outer}const Page = (() => { setVisited(true); return <p />; }) as FC;`,
      errors: [{ messageId: "writeInRender", data: { name: "setVisited", component: "Page" } }],
    },
    // Edge cases: a write inside a JSX spread object is still part of the render.
    {
      name: "write inside a JSX spread object",
      code: `${outer}function Page() { return <p {...{ title: setVisited(true) }} />; }`,
      errors: [{ messageId: "writeInRender", data: { name: "setVisited", component: "Page" } }],
    },
    // Edge cases: optional calls are still calls of the setter.
    {
      name: "optional call of the setter",
      code: `${outer}function Page() { setVisited?.(true); return <p />; }`,
      errors: [{ messageId: "writeInRender" }],
    },
    // Edge cases: a comment on the write line does not hide it.
    {
      name: "comment on the write line",
      code: `${outer}function Page() {\n  setVisited(true); // seed the visit log\n  return <p />;\n}`,
      errors: [{ messageId: "writeInRender" }],
    },
  ],
});
