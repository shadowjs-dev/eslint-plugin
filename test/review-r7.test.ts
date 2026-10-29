import { hooksInOwner } from "../src/rules/hooks-in-owner";
import { noPhysicalDirectionClasses } from "../src/rules/no-physical-direction-classes";
import { noReactPatterns } from "../src/rules/no-react-patterns";
import { signalMustBeCalled } from "../src/rules/signal-must-be-called";
import { runRule } from "./support/tester";

const shadow = 'import { useSignal, useEffect } from "@shadow-js/core";\n';
const core = 'import { useSignal } from "@shadow-js/core";\n';

// [ESL-R7-1] A dependency array is removed by the autofix only when the body does not write a signal it reads.
runRule("ESL-R7-1", "no-react-patterns (dependency arrays that loop)", noReactPatterns, {
  valid: [],
  invalid: [
    {
      name: "the body reads and writes the same signal: a suggestion with the reason, no autofix",
      code: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { setN(n() + props.x); }, [props.x]);`,
      errors: [
        {
          messageId: "dependencyArrayLoops",
          suggestions: [
            {
              messageId: "removeDependencyArray",
              output: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { setN(n() + props.x); });`,
            },
          ],
        },
      ],
    },
    {
      name: "the body only writes: the array is dropped",
      code: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { setN(props.x); }, [props.x]);`,
      output: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { setN(props.x); });`,
      errors: [{ messageId: "dependencyArray" }],
    },
    {
      name: "an updater function reads nothing: the array is dropped",
      code: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { setN((prev) => prev + props.x); }, [props.x]);`,
      output: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { setN((prev) => prev + props.x); });`,
      errors: [{ messageId: "dependencyArray" }],
    },
    {
      name: "the body reads a signal that is written elsewhere: the array is dropped",
      code: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { log(n()); }, [n]);`,
      output: `${shadow}const [n, setN] = useSignal(0);\nuseEffect(() => { log(n()); });`,
      errors: [{ messageId: "dependencyArray" }],
    },
    {
      name: "a layout effect that reads and writes: the suggestion renames it too",
      code: `import { useLayoutEffect } from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [n, setN] = useSignal(0);\nuseLayoutEffect(() => { setN(n() + 1); }, [props.x]);`,
      errors: [
        {
          messageId: "dependencyArrayLoops",
          suggestions: [
            {
              messageId: "removeDependencyArray",
              output: `import { useLayoutEffect } from "react";\nimport { useSignal, useRenderEffect } from "@shadow-js/core";\nconst [n, setN] = useSignal(0);\nuseRenderEffect(() => { setN(n() + 1); });`,
            },
          ],
        },
      ],
    },
  ],
});

// [ESL-R7-2] A lazy `useState` initializer is unwrapped, because `useSignal` would store the function.
runRule("ESL-R7-2", "no-react-patterns (lazy useState initializer)", noReactPatterns, {
  valid: [],
  invalid: [
    {
      name: "an arrow initializer becomes its expression",
      code: 'import { useState } from "react";\nconst [n, setN] = useState(() => expensive());',
      output:
        'import { useState } from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [n, setN] = useSignal(expensive());',
      errors: [{ messageId: "state" }],
    },
    {
      name: "a parenthesized object body is the plain argument",
      code: 'import { useState } from "react";\nconst [o, setO] = useState(() => ({ a: 1 }));',
      output:
        'import { useState } from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [o, setO] = useSignal({ a: 1 });',
      errors: [{ messageId: "state" }],
    },
    {
      name: "a sequence body keeps its parentheses so it stays one argument",
      code: 'import { useState } from "react";\nconst [n, setN] = useState(() => (a(), b()));',
      output:
        'import { useState } from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [n, setN] = useSignal((a(), b()));',
      errors: [{ messageId: "state" }],
    },
    {
      name: "a block-bodied initializer cannot be unwrapped: report only",
      code: 'import { useState } from "react";\nconst [n, setN] = useState(() => { return expensive(); });',
      errors: [{ messageId: "state" }],
    },
    {
      name: "a function expression initializer: report only",
      code: 'import { useState } from "react";\nconst [n, setN] = useState(function () { return 1; });',
      errors: [{ messageId: "state" }],
    },
  ],
});

// [ESL-R7-3] hooks after an await in an async function have lost the owner.
runRule("ESL-R7-3", "hooks-in-owner (after an await)", hooksInOwner, {
  valid: [
    'import { onMount, onCleanup } from "@shadow-js/core";\nfunction Page() { onMount(async () => { onCleanup(stop); await load(); }); return <p />; }',
    'import { onMount, onCleanup } from "@shadow-js/core";\nfunction Page() { onMount(async () => { await load(); register(() => onCleanup(stop)); }); return <p />; }',
    'import { onCleanup } from "@shadow-js/core";\nfunction Page() { const run = async () => { await load(); }; onCleanup(stop); return <p />; }',
  ],
  invalid: [
    {
      name: "onCleanup after an await in an onMount callback",
      code: 'import { onMount, onCleanup } from "@shadow-js/core";\nfunction Page() { onMount(async () => { await load(); onCleanup(stop); }); return <p />; }',
      errors: [
        {
          messageId: "outsideOwner",
          data: { name: "onCleanup", where: "after an `await` in an async function" },
        },
      ],
    },
    {
      name: "a hook after an await in an async custom hook",
      code: 'import { useEffect } from "@shadow-js/core";\nasync function useData() { const data = await load(); useEffect(() => log(data)); }',
      errors: [{ messageId: "outsideOwner" }],
    },
    {
      name: "a hook after a for-await loop",
      code: 'import { onCleanup } from "@shadow-js/core";\nasync function useStream(stream) { for await (const part of stream) { use(part); } onCleanup(stop); }',
      errors: [{ messageId: "outsideOwner" }],
    },
  ],
});

// [ESL-R7-4] A compound assignment with an accessor on the right is arithmetic or concatenation.
runRule("ESL-R7-4", "signal-must-be-called (compound assignment)", signalMustBeCalled, {
  valid: [
    `${core}const [count] = useSignal(0);\nlet t = 0;\nt ||= count;\nt &&= count;\nt ??= count;\nt = count;`,
    `${core}const [count] = useSignal(0);\nlet t = 0;\nt += count();`,
  ],
  invalid: [
    ...["+=", "-=", "*=", "/=", "%=", "**="].map((operator) => ({
      name: `\`${operator}\` reads the accessor as a value`,
      code: `${core}const [count] = useSignal(0);\nlet t = 1;\nt ${operator} count;`,
      output: `${core}const [count] = useSignal(0);\nlet t = 1;\nt ${operator} count();`,
      errors: [{ messageId: "mustCall" as const }],
    })),
  ],
});

// [ESL-R7-5] Only real Tailwind utilities are rewritten, and the missed ones are covered.
runRule("ESL-R7-5", "no-physical-direction-classes (utilities only)", noPhysicalDirectionClasses, {
  valid: [
    '<div class="left-panel right-rail text-left-aligned border-left-accent" />',
    '<div class="ml-panel pl-sidebar mr-x rounded-left" />',
    '<div class="float-leftover clear-rightish" />',
    '<div class="ms-2 rounded-ss-md rounded-ee-lg float-start clear-end" />',
  ],
  invalid: [
    {
      name: "the utilities with a valid value are rewritten",
      code: '<div class="ml-2 -mr-0.5 pl-px pr-auto left-1/2 -right-[3px] left-full scroll-ml-4 border-l-2 rounded-r-md text-right" />',
      errors: [
        {
          messageId: "physical",
          suggestions: [
            {
              messageId: "logical",
              output:
                '<div class="ms-2 -me-0.5 ps-px pe-auto start-1/2 -end-[3px] start-full scroll-ms-4 border-s-2 rounded-e-md text-end" />',
            },
          ],
        },
      ],
    },
    {
      name: "per-corner radii, float and clear have logical equivalents",
      code: '<div class="rounded-tl-md rounded-tr-lg rounded-bl rounded-br-full float-left float-right clear-left clear-right rounded-l rounded-r-none" />',
      errors: [
        {
          messageId: "physical",
          suggestions: [
            {
              messageId: "logical",
              output:
                '<div class="rounded-ss-md rounded-se-lg rounded-es rounded-ee-full float-start float-end clear-start clear-end rounded-s rounded-e-none" />',
            },
          ],
        },
      ],
    },
    {
      name: "an author class next to a utility is left alone",
      code: '<div class="left-panel ml-2 text-left-aligned" />',
      errors: [
        {
          messageId: "physical",
          suggestions: [
            { messageId: "logical", output: '<div class="left-panel ms-2 text-left-aligned" />' },
          ],
        },
      ],
    },
  ],
});
