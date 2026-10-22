import { noWriteInMemo } from "../../src/rules/no-write-in-memo";
import { runRule } from "../support/tester";

const core =
  'import { useSignal, useMemo, useEffect, batch, writeSignal, createComputation } from "@shadow-js/core";\n';
const store = 'import { useStore } from "@shadow-js/core/store";\n';
const sigs = `${core}const [a, setA] = useSignal(1);\nconst [b, setB] = useSignal(2);\n`;

runRule("ESL-03", "no-write-in-memo", noWriteInMemo, {
  valid: [
    `${sigs}const total = useMemo(() => a() + b());`,
    // Writes from effects are the right place.
    `${sigs}useEffect(() => { setA(b()); });`,
    // A nested function that may run later (event handler, timer) is not part of the computation.
    `${sigs}const total = useMemo(() => { const reset = () => setA(0); return a() + (reset ? 1 : 0); });`,
    `${sigs}const total = useMemo(() => { setTimeout(() => setA(0)); return a(); });`,
    // Same-named function that is not a tracked setter.
    `${sigs}function setC(v: number) { return v; }\nconst total = useMemo(() => setC(a()));`,
    // The documented escape hatch.
    `${core}const node = createSignalNode(0, Object.is);\nconst m = useMemo(() => writeSignal(node, 1, { allowInMemo: true }));`,
    // Another library's useMemo.
    'import { useMemo } from "react";\nconst [a, setA] = useState(0);\nconst v = useMemo(() => { setA(1); return 1; }, []);',
    // Setters of stores outside memos.
    `${store}const [state, setState] = useStore({ n: 0 });\nsetState((d) => { d.n = 1; });`,
    // A different callback position of useMemo (options) is not the computation.
    `${sigs}const total = useMemo(() => a(), { equals: (x, y) => { setB(1); return x === y; } });`,
    // Edge cases: a setter in a function that the memo only defines, behind a cast, is not run.
    `${sigs}const total = useMemo((() => { const reset = (() => setA(0)) as () => void; return a() + (reset ? 1 : 0); }) as () => number);`,
    // [ESL-03.E1] The escape hatch written with a TypeScript wrapper around the literal `true`.
    `${core}const node = createSignalNode(0, Object.is);\nconst m = useMemo(() => writeSignal(node, 1, { allowInMemo: true as const }));`,
    `${core}const node = createSignalNode(0, Object.is);\nconst m = useMemo(() => writeSignal(node, 1, { allowInMemo: true satisfies boolean }));`,
  ],
  invalid: [
    // [ESL-03.E2] A `false` behind a cast does not allow the write.
    {
      name: "writeSignal with allowInMemo false behind a cast",
      code: `${core}const node = createSignalNode(0, Object.is);\nconst m = useMemo(() => writeSignal(node, 1, { allowInMemo: false as const }));`,
      errors: [{ messageId: "writeInMemo", data: { name: "writeSignal" } }],
    },
    // [ESL-03.E3] A cast, satisfies or non-null wrapper around an IIFE, iteration or runner callback
    // still runs the write inside the memo.
    {
      name: "setter in an IIFE behind a cast",
      code: `${sigs}const total = useMemo(() => { ((() => setA(0)) as () => void)(); return a(); });`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
    {
      name: "setter in an iteration callback behind a cast",
      code: `${sigs}const total = useMemo(() => { [a()].forEach(((v: number) => { setA(v); }) as (v: number) => void); return a(); });`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
    {
      name: "setter in a runner callback behind satisfies",
      code: `${sigs}const total = useMemo(() => { batch((() => { setA(1); }) satisfies () => void); return a(); });`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
    {
      name: "setter in a runner callback behind a non-null assertion",
      code: `${sigs}const total = useMemo(() => { batch((() => { setA(1); })!); return a(); });`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
    {
      name: "setter in memo",
      code: `${sigs}const total = useMemo(() => { const sum = a() + b(); setA(sum); return sum; });`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
    {
      name: "expression body memo",
      code: `${sigs}const total = useMemo(() => setA(b()));`,
      errors: [{ messageId: "writeInMemo" }],
    },
    {
      name: "inside array iteration run by the memo",
      code: `${sigs}const total = useMemo(() => [1, 2].map((n) => { setA(n); return n; }));`,
      errors: [{ messageId: "writeInMemo" }],
    },
    {
      name: "inside an immediately invoked function and batch",
      code: `${sigs}const total = useMemo(() => { (() => setA(1))(); batch(() => setB(2)); return 0; });`,
      errors: [{ messageId: "writeInMemo" }, { messageId: "writeInMemo" }],
    },
    {
      name: "store setter",
      code: `${core}${store}const [state, setState] = useStore({ n: 0 });\nconst m = useMemo(() => { setState((d) => { d.n = 1; }); return 1; });`,
      errors: [{ messageId: "writeInMemo", data: { name: "setState" } }],
    },
    {
      name: "aliased setter",
      code: `${sigs}const write = setA;\nconst m = useMemo(() => { write(3); return 1; });`,
      errors: [{ messageId: "writeInMemo", data: { name: "write" } }],
    },
    {
      name: "writeSignal without the escape hatch",
      code: `${core}const node = createSignalNode(0, Object.is);\nconst m = useMemo(() => writeSignal(node, 1));`,
      errors: [{ messageId: "writeInMemo", data: { name: "writeSignal" } }],
    },
    {
      name: "createComputation memo",
      code: `${core}const [a, setA] = useSignal(1);\ncreateComputation({ kind: "memo", fn: () => { setA(2); return 1; } });`,
      errors: [{ messageId: "writeInMemo" }],
    },
    {
      name: "renamed useMemo",
      code: 'import { useMemo as memo, useSignal } from "@shadow-js/core";\nconst [a, setA] = useSignal(1);\nconst m = memo(() => { setA(2); return 1; });',
      errors: [{ messageId: "writeInMemo" }],
    },
    // Edge cases: a TypeScript cast around the compute function still makes it the memo.
    {
      name: "cast around the memo compute function",
      code: `${sigs}const total = useMemo((() => { setA(b()); return a(); }) as () => number);`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
    {
      name: "cast around the memo fn of createComputation",
      code: `${core}const [a, setA] = useSignal(1);\ncreateComputation({ kind: "memo" as const, fn: ((() => { setA(2); return 1; }) satisfies () => number) });`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
    // Edge cases: a comment on the write line does not change what is reported.
    {
      name: "comment on the write line",
      code: `${sigs}const total = useMemo(() => {\n  setA(b()); // keep the last value\n  return a();\n});`,
      errors: [{ messageId: "writeInMemo", data: { name: "setA" } }],
    },
  ],
});
