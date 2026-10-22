import { signalMustBeCalled } from "../../src/rules/signal-must-be-called";
import { runRule } from "../support/tester";

const core =
  'import { useSignal, useMemo, useResource, useSelector, children } from "@shadow-js/core";\n';
const store = 'import { useStore } from "@shadow-js/core/store";\n';
const sig = `${core}const [count, setCount] = useSignal(0);\n`;

runRule("ESL-02", "signal-must-be-called", signalMustBeCalled, {
  valid: [
    `${sig}const next = count() + 1;`,
    // Accessors are fine as JSX children and attribute values: the runtime calls them.
    `${sig}const view = <span title={count}>{count}</span>;`,
    `${sig}const view = <Child value={count} />;`,
    // Passing the accessor to another function is how it travels.
    `${sig}track(count);\nconst fn = () => count;`,
    `${sig}function forward() { return count; }`,
    // The setter is not an accessor.
    `${sig}setCount(count() + 1);`,
    // A store is read by property, not called.
    `${store}const [state] = useStore({ n: 0 });\nconst next = state.n + 1;\nif (state.n) {}`,
    // useStore with an object is a store view; its members are plain.
    `${store}const [todos] = useStore([{ id: 1 }]);\nconst first = todos[0].id + todos.length;`,
    // useStore with an unknown initial value cannot be judged without types.
    `${store}const [value] = useStore(initial);\nconst next = value + 1;`,
    // Shadowed names are not the signal.
    `${sig}function f(count: number) { return count + 1; }`,
    `${sig}const g = () => { const count = 3; return \`\${count}\`; };`,
    // Property names and keys are not references.
    `${sig}const o = { count: 1 };\nconst n = o.count + 1;`,
    // Equality with another expression is allowed (identity comparison of accessors).
    `${sig}const same = count === other;`,
    // typeof / instanceof / in are not value uses.
    `${sig}const t = typeof count === "function";`,
    // Another library's hooks return values.
    'import { useMemo } from "react";\nconst total = useMemo(() => 1, []);\nconst n = total + 1;',
    // A local hook of the same name is not ours.
    "function useSignal(v: number) { return [v, () => undefined] as const; }\nconst [c] = useSignal(1);\nconst n = c + 1;",
    // Function.prototype helpers are fine on accessors.
    `${sig}const bound = count.bind(null);`,
    // Resource members.
    `${core}const user = useResource(() => load());\nconst busy = user.loading;\nuser.refetch();\nconst s = user.state;`,
    // children() accessors carry toArray().
    `${core}const kids = children(() => props.children);\nconst list = kids.toArray();\nconst one = kids();`,
    // Elements other than the first of the tuple.
    `${sig}const [, set2] = useSignal(1);\nset2(2);`,
    // Comparison with null/undefined is a presence check on optional accessors.
    `${sig}const has = count != null && count !== undefined;`,
    // Coercing callee that is not global.
    `${sig}const o = { Number: (v: unknown) => v };\no.Number(count);`,
    // Calling with `call`.
    `${sig}const v = count.call(null);`,
    // `typeof` type query in a type position.
    `${sig}type T = typeof count;`,
    // Used in a JSX spread: not a value context for this rule.
    `${sig}const view = <div {...{ a: count }} />;`,
    // [ESL-02.E1] A tagged template hands the accessor to the tag, as a call argument does.
    `${sig}const style = css\`color: \${count};\`;`,
  ],
  invalid: [
    {
      name: "useStore with a primitive is a single-value cell: an accessor",
      code: `${store}const [n, setN] = useStore(0);\nconst next = n + 1;`,
      output: `${store}const [n, setN] = useStore(0);\nconst next = n() + 1;`,
      errors: [{ messageId: "mustCall", data: { name: "n", kind: "signal" } }],
    },
    {
      name: "arithmetic",
      code: `${sig}const next = count + 1;`,
      output: `${sig}const next = count() + 1;`,
      errors: [{ messageId: "mustCall", data: { name: "count", kind: "signal" } }],
    },
    {
      name: "string concatenation",
      code: `${sig}const label = "n=" + count;`,
      output: `${sig}const label = "n=" + count();`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "comparison",
      code: `${sig}const big = count > 10;`,
      output: `${sig}const big = count() > 10;`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "equality with a literal",
      code: `${sig}const zero = count === 0;`,
      output: `${sig}const zero = count() === 0;`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "template literal",
      code: `${sig}const label = \`Count: \${count}\`;`,
      output: `${sig}const label = \`Count: \${count()}\`;`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "if condition",
      code: `${sig}if (count) { start(); }`,
      output: `${sig}if (count()) { start(); }`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "ternary test",
      code: `${sig}const x = count ? "a" : "b";`,
      output: `${sig}const x = count() ? "a" : "b";`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "logical left operand in JSX",
      code: `${sig}const view = <div>{count && <b />}</div>;`,
      output: `${sig}const view = <div>{count() && <b />}</div>;`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "negation",
      code: `${sig}const off = !count;`,
      output: `${sig}const off = !count();`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "member access",
      code: `${core}const [items] = useSignal<string[]>([]);\nconst size = items.length;`,
      output: `${core}const [items] = useSignal<string[]>([]);\nconst size = items().length;`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "computed index",
      code: `${core}const [i] = useSignal(0);\nconst v = list[i];`,
      output: `${core}const [i] = useSignal(0);\nconst v = list[i()];`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "memo accessor",
      code: `${core}const double = useMemo(() => 2);\nconst n = double * 2;`,
      output: `${core}const double = useMemo(() => 2);\nconst n = double() * 2;`,
      errors: [{ messageId: "mustCall", data: { name: "double", kind: "memo" } }],
    },
    {
      name: "alias of a signal",
      code: `${sig}const c = count;\nconst n = c + 1;`,
      output: `${sig}const c = count;\nconst n = c() + 1;`,
      errors: [{ messageId: "mustCall", data: { name: "c", kind: "signal" } }],
    },
    {
      name: "renamed import",
      code: 'import { useSignal as sig } from "@shadow-js/core";\nconst [n] = sig(0);\nconst m = n * 2;',
      output:
        'import { useSignal as sig } from "@shadow-js/core";\nconst [n] = sig(0);\nconst m = n() * 2;',
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "namespace import",
      code: 'import * as core from "@shadow-js/core";\nconst [n] = core.useSignal(0);\nconst m = n * 2;',
      output:
        'import * as core from "@shadow-js/core";\nconst [n] = core.useSignal(0);\nconst m = n() * 2;',
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "use inside a nested closure and before the declaration in source order",
      code: `${core}function early() { return count + 1; }\nconst [count] = useSignal(0);`,
      output: `${core}function early() { return count() + 1; }\nconst [count] = useSignal(0);`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "TypeScript wrappers",
      code: `${sig}const n = (count as unknown as number) + 1;`,
      output: `${sig}const n = (count() as unknown as number) + 1;`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "Math and coercions",
      code: `${sig}const m = Math.max(count, 1);\nconst s = Number(count);`,
      output: `${sig}const m = Math.max(count(), 1);\nconst s = Number(count());`,
      errors: [{ messageId: "mustCall" }, { messageId: "mustCall" }],
    },
    {
      name: "spread and for-of",
      code: `${core}const [list] = useSignal<number[]>([]);\nconst copy = [...list];\nfor (const x of list) {}`,
      output: `${core}const [list] = useSignal<number[]>([]);\nconst copy = [...list()];\nfor (const x of list()) {}`,
      errors: [{ messageId: "mustCall" }, { messageId: "mustCall" }],
    },
    {
      name: "switch discriminant",
      code: `${sig}switch (count) { default: break; }`,
      output: `${sig}switch (count()) { default: break; }`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "resource used as a value",
      code: `${core}const user = useResource(() => load());\nconst name = user.name;`,
      output: `${core}const user = useResource(() => load());\nconst name = user().name;`,
      errors: [{ messageId: "mustCall", data: { name: "user", kind: "resource" } }],
    },
    {
      name: "selector and children accessors",
      code: `${core}const isSel = useSelector(() => 1);\nconst ok = isSel ? 1 : 2;\nconst kids = children(() => null);\nconst has = kids && 1;`,
      output: `${core}const isSel = useSelector(() => 1);\nconst ok = isSel() ? 1 : 2;\nconst kids = children(() => null);\nconst has = kids() && 1;`,
      errors: [{ messageId: "mustCall" }, { messageId: "mustCall" }],
    },
    {
      name: "unbound global hook (snippets)",
      code: "const [n] = useSignal(0);\nconst m = n + 1;",
      output: "const [n] = useSignal(0);\nconst m = n() + 1;",
      errors: [{ messageId: "mustCall" }],
    },
    // [ESL-02.E3] A non-null assertion or `satisfies` around the accessor is still a value read.
    {
      name: "[ESL-02.E3] non-null and satisfies wrappers keep the value read",
      code: `${sig}const a = count! + 1;\nconst b = (count satisfies number) * 2;`,
      output: `${sig}const a = count()! + 1;\nconst b = (count() satisfies number) * 2;`,
      errors: [{ messageId: "mustCall" }, { messageId: "mustCall" }],
    },
    // [ESL-02.E4] An async arrow or async function body is inspected like any other function body.
    {
      name: "[ESL-02.E4] async arrow and async function bodies",
      code: `${sig}const load = async () => count + 1;\nasync function run() { return count * 2; }`,
      output: `${sig}const load = async () => count() + 1;\nasync function run() { return count() * 2; }`,
      errors: [{ messageId: "mustCall" }, { messageId: "mustCall" }],
    },
    // [ESL-02.E5] Comments on the reported line stay in place; the call is inserted after the name.
    {
      name: "[ESL-02.E5] a comment on the reported line is kept by the fix",
      code: `${sig}const next = count /* keep */ + 1; // trailing`,
      output: `${sig}const next = count() /* keep */ + 1; // trailing`,
      errors: [{ messageId: "mustCall" }],
    },
    // [ESL-02.E6] Optional chaining reads the value of the accessor, so the call goes before `?.`.
    {
      name: "[ESL-02.E6] optional chaining on an accessor",
      code: `${core}const [items] = useSignal<string[]>([]);\nconst n = items?.length;`,
      output: `${core}const [items] = useSignal<string[]>([]);\nconst n = items()?.length;`,
      errors: [{ messageId: "mustCall" }],
    },
    // [ESL-02.E7] A destructuring default that computes from the accessor reads its value.
    {
      name: "[ESL-02.E7] a destructuring default computed from the accessor",
      code: `${sig}const { a = count + 1 } = { a: undefined };`,
      output: `${sig}const { a = count() + 1 } = { a: undefined };`,
      errors: [{ messageId: "mustCall" }],
    },
    // [ESL-02.E8] A JSX spread needs an object: a spread of the accessor itself spreads nothing.
    {
      name: "[ESL-02.E8] spreading the accessor in JSX",
      code: `${sig}const view = <div {...count} />;`,
      output: `${sig}const view = <div {...count()} />;`,
      errors: [{ messageId: "mustCall" }],
    },
    {
      name: "[ESL-02.E9] a computed value inside a JSX spread object",
      code: `${sig}const view = <div {...{ a: count + 1 }} />;`,
      output: `${sig}const view = <div {...{ a: count() + 1 }} />;`,
      errors: [{ messageId: "mustCall" }],
    },
  ],
});
