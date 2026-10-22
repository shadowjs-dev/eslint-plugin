import { noReactPatterns } from "../../src/rules/no-react-patterns";
import { runRule } from "../support/tester";

const both = [{ frameworks: ["react", "solid"] }];

runRule("ESL-09", "no-react-patterns", noReactPatterns, {
  valid: [
    'import { useSignal, useEffect } from "@shadow-js/core";\nconst [n, setN] = useSignal(0);\nuseEffect(() => { log(n()); });',
    '<input class="field" onInput={update} />',
    // Checkbox, radio, file and select use change events as in the DOM.
    '<input type="checkbox" onChange={toggle} />',
    '<input type="radio" onChange={pick} />',
    "<select onChange={pick} />",
    '<input type="file" onChange={upload} />',
    "<input type={kind()} onChange={x} />",
    // key on For is the keyed list API.
    "<For each={rows()} key={(r) => r.id}>{(r) => <li>{r().name}</li>}</For>",
    // Local functions named like hooks are not React's.
    "function useState(v: number) { return [v, () => undefined]; }\nconst [a] = useState(0);",
    // Solid names are ignored unless enabled.
    'import { createSignal } from "solid-js";\nconst [n] = createSignal(0);',
    // Type-only imports are left alone.
    'import type { ReactNode } from "react";\ntype X = ReactNode;',
    '<label for="x">Name</label>',
    "<div classList={{ on: x() }} />",
    // className is a prop of the component, not a DOM attribute.
    '<Box className="x" htmlFor="y" />',
    // ShadowJS useEffect forms without dependency arrays.
    'import { useEffect, useMemo } from "@shadow-js/core";\nuseEffect(() => { run(); });\nuseEffect(id, (v) => { run(v); }, { defer: true });\nconst m = useMemo(() => 1, { name: "m" });',
    // Not our import.
    'import { useState } from "preact/hooks";\nconst [n] = useState(0);',
    // DEC-REACT-NAMES: the compiler keeps these React
    // spellings working with React's meaning, so a port has nothing to change.
    {
      name: "[ESL-09.B1] onChange on a text input is per edit, as in React",
      code: "<input onChange={update} />",
    },
    {
      name: "[ESL-09.B2] onChange on text-like input types and textarea is per edit",
      code: '<form><input type="email" onChange={a} /><textarea onChange={b} /></form>',
    },
    {
      name: "[ESL-09.B3] key on a component is passed to it as a prop",
      code: "<Row key={id} item={item} />",
    },
    {
      name: "[ESL-09.B4] defaultValue and defaultChecked set the initial value",
      code: '<input defaultValue="x" defaultChecked />',
    },
    // Frameworks option: react-only checks ignore solid-js.
    {
      code: 'import { createEffect } from "solid-js";\ncreateEffect(() => {});',
      options: [{ frameworks: ["react"] }],
    },
    // [ESL-09.S] Solid's onChange is the committed change; ShadowJS's onChange on a text input is
    // per edit. The rule reports the text case only where the code is Solid code (see the TSDoc).
    {
      name: "[ESL-09.S1] migration of React code: onChange on a text input is per edit, not a Solid port",
      code: 'import type { ChangeEvent } from "react";\nconst view = <input onChange={(e: ChangeEvent<HTMLInputElement>) => update(e)} />;',
      options: both,
    },
    {
      name: "[ESL-09.S2] both frameworks, no framework import: the file is not known to be Solid",
      code: "const view = <input onChange={update} />;",
      options: both,
    },
    {
      name: "[ESL-09.S3] a Solid file ported with frameworks react only is not checked for Solid",
      code: 'import { createSignal } from "solid-js";\nconst view = <input onChange={update} />;',
      options: [{ frameworks: ["react"] }],
    },
    {
      name: "[ESL-09.S4] Solid-only: a checkbox, radio, file or select already means change",
      code: '<form><input type="checkbox" onChange={a} /><input type="radio" onChange={b} /><input type="file" onChange={c} /><select onChange={d} /></form>',
      options: [{ frameworks: ["solid"] }],
    },
    {
      name: "[ESL-09.S5] Solid-only: onChange on a component is a prop, not the DOM event",
      code: "<Field onChange={update} />",
      options: [{ frameworks: ["solid"] }],
    },
    {
      name: "[ESL-09.S6] Solid-only: onInput and the lower-case onchange are already the right events",
      code: "<form><input onInput={a} /><input onchange={b} /><textarea onchange={c} /></form>",
      options: [{ frameworks: ["solid"] }],
    },
  ],
  invalid: [
    {
      name: "useState becomes a signal and reads become calls",
      code: 'import { useState } from "react";\nconst [count, setCount] = useState(0);\nconst view = <b>{count}</b>;\nsetCount(count + 1);',
      output:
        'import { useState } from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [count, setCount] = useSignal(0);\nconst view = <b>{count()}</b>;\nsetCount(count() + 1);',
      errors: [{ messageId: "state" }],
    },
    {
      name: "useState shorthand property reads",
      code: 'import { useState } from "react";\nconst [id, setId] = useState(0);\nconst o = { id };',
      output:
        'import { useState } from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [id, setId] = useSignal(0);\nconst o = { id: id() };',
      errors: [{ messageId: "state" }],
    },
    {
      name: "useState result that is not destructured: report only",
      code: 'import { useState } from "react";\nconst pair = useState(0);',
      errors: [{ messageId: "state" }],
    },
    {
      name: "useState whose value is reassigned: report only",
      code: 'import { useState } from "react";\nlet [n, setN] = useState(0);\nn = 5;',
      errors: [{ messageId: "state" }],
    },
    {
      name: "React.useState through the default import",
      code: 'import React from "react";\nconst [n, setN] = React.useState(0);\nconst m = n + 1;',
      output:
        'import React from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [n, setN] = useSignal(0);\nconst m = n() + 1;',
      errors: [{ messageId: "state" }],
    },
    {
      name: "dependency array is removed; the import moves",
      code: 'import { useEffect } from "react";\nuseEffect(() => { log(a); }, [a]);',
      output: 'import { useEffect } from "@shadow-js/core";\nuseEffect(() => { log(a); });',
      errors: [
        {
          messageId: "foreignImport",
          data: { name: "useEffect", source: "react", target: "@shadow-js/core" },
        },
        { messageId: "dependencyArray", data: { name: "useEffect" } },
      ],
    },
    {
      name: "a dependency array left after the import was moved",
      code: 'import { useEffect } from "@shadow-js/core";\nuseEffect(() => { log(a()); }, [a]);',
      output: 'import { useEffect } from "@shadow-js/core";\nuseEffect(() => { log(a()); });',
      errors: [{ messageId: "dependencyArray", data: { name: "useEffect" } }],
    },
    {
      name: "empty dependency array becomes onMount",
      code: 'import { useEffect } from "@shadow-js/core";\nuseEffect(() => { start(); }, []);',
      output: 'import { useEffect, onMount } from "@shadow-js/core";\nonMount(() => { start(); });',
      errors: [{ messageId: "emptyDeps", data: { name: "useEffect" } }],
    },
    {
      name: "useMemo: accessor reads and no dependency array",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
      code: 'import { useMemo } from "react";\nconst total = useMemo(() => a + b, [a, b]);\nconst label = `Total ${total}`;',
      output:
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the sample code contains a template literal
        'import { useMemo } from "@shadow-js/core";\nconst total = useMemo(() => a + b);\nconst label = `Total ${total()}`;',
      errors: [
        {
          messageId: "foreignImport",
          data: { name: "useMemo", source: "react", target: "@shadow-js/core" },
        },
        { messageId: "memoAccessor" },
      ],
    },
    {
      name: "[ESL-09.P1] useSyncExternalStore is renamed to useExternalStore (same arguments)",
      code: 'import { useSyncExternalStore } from "react";\nconst online = useSyncExternalStore(subscribe, getSnapshot);',
      output:
        'import { useSyncExternalStore } from "react";\nimport { useExternalStore } from "@shadow-js/core";\nconst online = useExternalStore(subscribe, getSnapshot);',
      errors: [{ messageId: "renamed" }],
    },
    {
      name: "[ESL-09.P2] useEffectEvent becomes useEvent",
      code: 'import { useEffectEvent } from "react";\nconst onTick = useEffectEvent(() => log(count));',
      output:
        'import { useEffectEvent } from "react";\nimport { useEvent } from "@shadow-js/core";\nconst onTick = useEvent(() => log(count));',
      errors: [{ messageId: "renamed" }],
    },
    {
      name: "[ESL-09.P3] useReducer keeps its name and moves to @shadow-js/core",
      code: 'import { useReducer } from "react";\nconst [n, dispatch] = useReducer(reduce, 0);',
      output:
        'import { useReducer } from "@shadow-js/core";\nconst [n, dispatch] = useReducer(reduce, 0);',
      errors: [{ messageId: "foreignImport" }],
    },
    {
      name: "[ESL-09.P4] createReaction (Solid) becomes useReaction",
      code: 'import { createReaction } from "solid-js";\nconst track = createReaction(() => stale());',
      output:
        'import { createReaction } from "solid-js";\nimport { useReaction } from "@shadow-js/core";\nconst track = useReaction(() => stale());',
      options: both,
      errors: [{ messageId: "renamed" }],
    },
    // DEC-CALLBACK: `useLayoutEffect` is renamed to
    // `useRenderEffect`, as the RENAMED table in src/data/foreign.ts says.
    {
      name: "[ESL-09.B5] useLayoutEffect without dependencies becomes useRenderEffect",
      code: 'import { useLayoutEffect } from "react";\nuseLayoutEffect(() => { measure(); });',
      output:
        'import { useLayoutEffect } from "react";\nimport { useRenderEffect } from "@shadow-js/core";\nuseRenderEffect(() => { measure(); });',
      errors: [{ messageId: "renamed", data: { from: "useLayoutEffect", to: "useRenderEffect" } }],
    },
    {
      name: "[ESL-09.B6] useLayoutEffect with dependencies becomes useRenderEffect without them",
      code: 'import { useLayoutEffect } from "react";\nuseLayoutEffect(() => { measure(a); }, [a]);',
      output:
        'import { useLayoutEffect } from "react";\nimport { useRenderEffect } from "@shadow-js/core";\nuseRenderEffect(() => { measure(a); });',
      errors: [{ messageId: "dependencyArray", data: { name: "useLayoutEffect" } }],
    },
    {
      name: "useCallback is unwrapped",
      code: 'import { useCallback } from "react";\nconst save = useCallback(() => store(id), [id]);',
      output: 'import { useCallback } from "react";\nconst save = () => store(id);',
      errors: [{ messageId: "useCallback" }],
    },
    {
      name: "memo is unwrapped",
      code: 'import { memo } from "react";\nconst Row = memo(function Row() { return <li />; });',
      output: 'import { memo } from "react";\nconst Row = function Row() { return <li />; };',
      errors: [{ messageId: "memo" }],
    },
    {
      name: "unused imports are removed",
      code: 'import { useState, useRef } from "react";\nconst x = 1;',
      output: 'import { useRef } from "react";\nconst x = 1;',
      errors: [
        { messageId: "unusedImport", data: { name: "useState", source: "react" } },
        { messageId: "unusedImport", data: { name: "useRef", source: "react" } },
      ],
    },
    {
      name: "a lone unused import goes away with its line",
      code: 'import { useState } from "react";\nconst x = 1;',
      output: "const x = 1;",
      errors: [{ messageId: "unusedImport" }],
    },
    {
      name: "unsupported hooks explain the alternative",
      code: 'import { useRef, useInsertionEffect, forwardRef } from "react";\nconst r = useRef(null);\nuseInsertionEffect(() => {});\nconst C = forwardRef(() => null);',
      errors: [
        {
          messageId: "noEquivalent",
          data: {
            name: "useRef",
            hint: "declare a plain variable for a value, or `createRef()` for an element ref (`ref={r}`, then `r.current`)",
          },
        },
        {
          messageId: "noEquivalent",
          data: {
            name: "useInsertionEffect",
            hint: "use `useRenderEffect` (it runs before user effects, in the same flush)",
          },
        },
        {
          messageId: "noEquivalent",
          data: {
            name: "forwardRef",
            hint: "refs are ordinary props: accept `ref` and pass it on",
          },
        },
      ],
    },
    {
      name: "className and htmlFor",
      code: '<label htmlFor="x" className="field">Name</label>',
      output: '<label for="x" class="field">Name</label>',
      errors: [{ messageId: "htmlFor" }, { messageId: "className" }],
    },
    {
      name: "key attribute: suggestion removes it",
      code: "<li key={item.id}>{item.name}</li>",
      errors: [
        {
          messageId: "key",
          data: { tag: "li" },
          suggestions: [{ messageId: "removeKey", output: "<li>{item.name}</li>" }],
        },
      ],
    },
    {
      name: "React imports that exist unchanged move to ShadowJS",
      code: 'import { Fragment, Suspense, createContext } from "react";\nconst C = createContext(1);\nconst v = <Suspense><Fragment /></Suspense>;',
      output:
        'import { Suspense, createContext } from "react";\nimport { Fragment } from "@shadow-js/web";\nconst C = createContext(1);\nconst v = <Suspense><Fragment /></Suspense>;',
      errors: [
        {
          messageId: "foreignImport",
          data: { name: "Fragment", source: "react", target: "@shadow-js/web" },
        },
        {
          messageId: "foreignImport",
          data: { name: "Suspense", source: "react", target: "@shadow-js/web" },
        },
        {
          messageId: "foreignImport",
          data: { name: "createContext", source: "react", target: "@shadow-js/core" },
        },
      ],
    },
    {
      name: "Solid: createSignal is useSignal",
      code: 'import { createSignal } from "solid-js";\nconst [n, setN] = createSignal(0);',
      options: both,
      output:
        'import { createSignal } from "solid-js";\nimport { useSignal } from "@shadow-js/core";\nconst [n, setN] = useSignal(0);',
      errors: [{ messageId: "renamed", data: { from: "createSignal", to: "useSignal" } }],
    },
    {
      name: "Solid: createEffect, createMemo, createResource, createStore are use* hooks",
      code: 'import { createEffect } from "solid-js";\ncreateEffect(() => {});',
      options: both,
      output:
        'import { createEffect } from "solid-js";\nimport { useEffect } from "@shadow-js/core";\nuseEffect(() => {});',
      errors: [{ messageId: "renamed", data: { from: "createEffect", to: "useEffect" } }],
    },
    {
      name: "Solid: createMemo",
      code: 'import { createMemo } from "solid-js";\nconst m = createMemo(() => 1);',
      options: both,
      output:
        'import { createMemo } from "solid-js";\nimport { useMemo } from "@shadow-js/core";\nconst m = useMemo(() => 1);',
      errors: [{ messageId: "renamed", data: { from: "createMemo", to: "useMemo" } }],
    },
    {
      name: "Solid: createResource",
      code: 'import { createResource } from "solid-js";\nconst r = createResource(f);',
      options: both,
      output:
        'import { createResource } from "solid-js";\nimport { useResource } from "@shadow-js/core";\nconst r = useResource(f);',
      errors: [{ messageId: "renamed", data: { from: "createResource", to: "useResource" } }],
    },
    {
      name: "Solid: createStore from the store entry",
      code: 'import { createStore } from "solid-js/store";\nconst s = createStore({});',
      options: both,
      output:
        'import { createStore } from "solid-js/store";\nimport { useStore } from "@shadow-js/core";\nconst s = useStore({});',
      errors: [{ messageId: "renamed", data: { from: "createStore", to: "useStore" } }],
    },
    {
      name: "Solid: a component import moves to @shadow-js/web",
      code: 'import { Show } from "solid-js";\nconst v = <Show when={a}>x</Show>;',
      options: both,
      output: 'import { Show } from "@shadow-js/web";\nconst v = <Show when={a}>x</Show>;',
      errors: [
        {
          messageId: "foreignImport",
          data: { name: "Show", source: "solid-js", target: "@shadow-js/web" },
        },
      ],
    },
    {
      name: "Solid: a core helper moves to @shadow-js/core, keeping the other specifiers",
      code: 'import { onCleanup, Switch } from "solid-js";\nonCleanup(stop);\nconst v = <Switch />;',
      options: both,
      output:
        'import { Switch } from "solid-js";\nimport { onCleanup } from "@shadow-js/core";\nonCleanup(stop);\nconst v = <Switch />;',
      errors: [
        {
          messageId: "foreignImport",
          data: { name: "onCleanup", source: "solid-js", target: "@shadow-js/core" },
        },
        {
          messageId: "foreignImport",
          data: { name: "Switch", source: "solid-js", target: "@shadow-js/web" },
        },
      ],
    },
    {
      name: "Solid: on() has no equivalent, and the effect around it is not renamed blindly",
      code: 'import { createEffect, on } from "solid-js";\ncreateEffect(on(a, () => {}));',
      options: both,
      errors: [
        { messageId: "renamed", data: { from: "createEffect", to: "useEffect" } },
        {
          messageId: "noEquivalent",
          data: {
            name: "on",
            hint: "pass the dependencies as the first argument of `useEffect(deps, fn)`",
          },
        },
      ],
    },
    {
      // A read wrapped in `as`, `satisfies` or `!` is still a value read and must become a call.
      name: "useState reads under TypeScript expression wrappers become calls",
      code: 'import { useState } from "react";\nconst [count, setCount] = useState(0);\nconst a = count as number;\nconst b = count!;\nconst c = count satisfies number;',
      output:
        'import { useState } from "react";\nimport { useSignal } from "@shadow-js/core";\nconst [count, setCount] = useSignal(0);\nconst a = count() as number;\nconst b = count()!;\nconst c = count() satisfies number;',
      errors: [{ messageId: "state" }],
    },
    // [ESL-09.S] Solid's onChange commits on change; ShadowJS's onChange on text is per edit. The
    // fix renames it to `onchange`, the native change event: the same behavior as Solid's.
    {
      name: "[ESL-09.S7] Solid-only: onChange on a text input becomes onchange (native change)",
      code: "const view = <input onChange={update} />;",
      output: "const view = <input onchange={update} />;",
      options: [{ frameworks: ["solid"] }],
      errors: [{ messageId: "solidChange", data: { tag: "input" } }],
    },
    {
      name: "[ESL-09.S8] Solid-only: textarea and range inputs are text-like too",
      code: '<form><textarea onChange={save} /><input type="range" onChange={level} /></form>',
      output: '<form><textarea onchange={save} /><input type="range" onchange={level} /></form>',
      options: [{ frameworks: ["solid"] }],
      errors: [
        { messageId: "solidChange", data: { tag: "textarea" } },
        { messageId: "solidChange", data: { tag: "input" } },
      ],
    },
    {
      name: "[ESL-09.S9] a Solid file under both frameworks: the import decides, and the fix applies",
      code: 'import type { JSX } from "solid-js";\nconst view: JSX.Element = <input onChange={(e: Event) => update(e)} />;',
      output:
        'import type { JSX } from "solid-js";\nconst view: JSX.Element = <input onchange={(e: Event) => update(e)} />;',
      options: both,
      errors: [{ messageId: "solidChange", data: { tag: "input" } }],
    },
    {
      name: "[ESL-09.S10] JSX spread and comments around the attribute keep their text",
      code: "const view = <input {...rest} /* committed */ onChange={update} />;",
      output: "const view = <input {...rest} /* committed */ onchange={update} />;",
      options: [{ frameworks: ["solid"] }],
      errors: [{ messageId: "solidChange", data: { tag: "input" } }],
    },
    {
      name: "[ESL-09.S11] TypeScript wrappers and an async handler are kept as written",
      code: "const view = <input onChange={(async (e: Event) => save(e)) as Handler} />;",
      output: "const view = <input onchange={(async (e: Event) => save(e)) as Handler} />;",
      options: [{ frameworks: ["solid"] }],
      errors: [{ messageId: "solidChange", data: { tag: "input" } }],
    },
    {
      name: "[ESL-09.S12] a dynamic input type may be text: reported, the rename is harmless for a checkbox",
      code: "const view = <input type={kind()} onChange={update} />;",
      output: "const view = <input type={kind()} onchange={update} />;",
      options: [{ frameworks: ["solid"] }],
      errors: [{ messageId: "solidChange", data: { tag: "input" } }],
    },
    {
      name: "[ESL-09.S13] one report per element, and no fix when onchange already exists",
      code: "const view = <input onChange={a} onchange={b} />;",
      output: null,
      options: [{ frameworks: ["solid"] }],
      errors: [{ messageId: "solidChange", data: { tag: "input" } }],
    },
  ],
});
