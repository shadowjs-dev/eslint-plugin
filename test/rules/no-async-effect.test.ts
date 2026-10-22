import { noAsyncEffect } from "../../src/rules/no-async-effect";
import { runRule } from "../support/tester";

const imports = 'import { useEffect, useMemo, useRenderEffect, onMount } from "@shadow-js/core";\n';

runRule("ESL-06", "no-async-effect", noAsyncEffect, {
  valid: [
    `${imports}useEffect(() => { document.title = "x"; });`,
    `${imports}useEffect(() => { void load(); });`,
    `${imports}useEffect(id, (value) => { void load(value); });`,
    `${imports}const total = useMemo(() => a() + b());`,
    // onMount is untracked and has no cleanup contract: async is the common way to load once.
    `${imports}onMount(async () => { await load(); });`,
    // An async function that is not passed to an effect.
    `${imports}async function load() { await fetch("/x"); }\nuseEffect(() => { void load(); });`,
    // Another library's useEffect is not ours.
    'import { useEffect } from "react";\nuseEffect(async () => { await load(); });',
    // A local function with the same name is not the framework's.
    "function useEffect(fn: unknown) { return fn; }\nuseEffect(async () => 1);",
    `${imports}useEffect(() => { const run = async () => { await load(); }; void run(); });`,
    // Arguments beyond the callback positions are options, not callbacks.
    `${imports}useEffect(id, (v) => { void v; }, { defer: true, name: "x" });`,
    // Edge cases: an async callback nested inside a synchronous effect is not the effect callback.
    `${imports}useEffect(() => { items.forEach(async (item) => { await save(item); }); });`,
  ],
  invalid: [
    {
      code: `${imports}useEffect(async () => { const data = await load(id()); setData(data); });`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect(() => {\n  void (async () => { const data = await load(id()); setData(data); })();\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "async function expression",
      code: `${imports}useEffect(async function () { await load(); });`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect(function () {\n  void (async () => { await load(); })();\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "deps form: the apply callback",
      code: `${imports}useEffect(id, async (value) => { await load(value); });`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect(id, (value) => {\n  void (async () => { await load(value); })();\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "expression body keeps object literals intact",
      code: `${imports}useEffect(async () => ({ a: await x() }));`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect(() => {\n  void (async () => ({ a: await x() }))();\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "useRenderEffect",
      code: `${imports}useRenderEffect(async () => { await x(); });`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useRenderEffect(() => {\n  void (async () => { await x(); })();\n});`,
            },
          ],
        },
      ],
    },
    {
      name: "async memo has no suggestion",
      code: `${imports}const total = useMemo(async () => (await fetchTotal()) + extra());`,
      errors: [{ messageId: "asyncMemo" }],
    },
    {
      name: "renamed and namespace imports",
      code: 'import { useEffect as effect } from "@shadow-js/core";\neffect(async () => { await x(); });',
      errors: [{ messageId: "asyncEffect", suggestions: 1 }],
    },
    {
      name: "namespace import",
      code: 'import * as core from "@shadow-js/core";\ncore.useEffect(async () => { await x(); });',
      errors: [{ messageId: "asyncEffect", suggestions: 1 }],
    },
    {
      name: "unbound global (snippets)",
      code: "useEffect(async () => { await x(); });",
      errors: [{ messageId: "asyncEffect", suggestions: 1 }],
    },
    {
      name: "type parameters block the suggestion",
      code: `${imports}useEffect(async <T,>() => { await x<T>(); });`,
      errors: [{ messageId: "asyncEffect", suggestions: 0 }],
    },
    // Edge cases: TypeScript casts around the callback are still the callback.
    {
      name: "as cast around the effect callback",
      code: `${imports}useEffect((async () => { await load(); }) as EffectFn);`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect((() => {\n  void (async () => { await load(); })();\n}) as EffectFn);`,
            },
          ],
        },
      ],
    },
    {
      name: "satisfies cast around the memo callback",
      code: `${imports}const total = useMemo((async () => 1) satisfies () => Promise<number>);`,
      errors: [{ messageId: "asyncMemo" }],
    },
    // Edge cases: a comment inside the body is kept by the suggestion.
    {
      name: "comment inside the body survives the suggestion",
      code: `${imports}useEffect(async () => {\n  // reload when the id changes\n  await load(id());\n});`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect(() => {\n  void (async () => {\n  // reload when the id changes\n  await load(id());\n})();\n});`,
            },
          ],
        },
      ],
    },
    // Edge cases: a named async function expression keeps its name, so a recursive call still
    // resolves inside the rewritten function.
    {
      name: "named async function expression keeps its name",
      code: `${imports}useEffect(async function poll() { await load(); poll(); });`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect(function poll() {\n  void (async () => { await load(); poll(); })();\n});`,
            },
          ],
        },
      ],
    },
    // Edge cases: destructured parameters with a default and a type annotation keep their text.
    {
      name: "destructured parameter with default and annotation",
      code: `${imports}useEffect(async ({ id = 1 }: { id?: number } = {}) => { await load(id); });`,
      errors: [
        {
          messageId: "asyncEffect",
          suggestions: [
            {
              messageId: "wrapInner",
              output: `${imports}useEffect(({ id = 1 }: { id?: number } = {}) => {\n  void (async () => { await load(id); })();\n});`,
            },
          ],
        },
      ],
    },
  ],
});
