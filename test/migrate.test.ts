import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../src/index";
import { shadowParser } from "./support/tester";

/** Applies every autofix of the migration config until the code settles (ESLint runs up to 10 passes). */
function migrate(code: string): { output: string; remaining: string[] } {
  const linter = new Linter({ configType: "flat" });
  const result = linter.verifyAndFix(
    code,
    [
      { languageOptions: { parser: shadowParser, ecmaVersion: 2023, sourceType: "module" } },
      plugin.configs.migration,
    ],
    { filename: "file.tsx" },
  );
  return {
    output: result.output,
    remaining: result.messages.map((m) => `${m.ruleId}: ${m.message}`),
  };
}

describe("[ESL-93] migration config ports React and Solid code", () => {
  const react = [
    'import React, { useState, useEffect, useMemo, useCallback, memo } from "react";',
    "",
    "const Counter = memo(function Counter({ start }) {",
    "  const [count, setCount] = useState(start);",
    "  const doubled = useMemo(() => count * 2, [count]);",
    "  const inc = useCallback(() => setCount(count + 1), [count]);",
    "  useEffect(() => { document.title = String(doubled); }, [doubled]);",
    '  useEffect(() => { console.log("mounted"); }, []);',
    '  return <button className="btn" onClick={inc}>{count} {doubled}</button>;',
    "});",
    "export default Counter;",
    "",
  ].join("\n");

  it("[ESL-93.1] a React component becomes a ShadowJS component with nothing left to report", () => {
    const { output, remaining } = migrate(react);
    expect(output).toBe(
      [
        'import { useEffect, useMemo, onMount, useSignal } from "@shadow-js/core";',
        "",
        "const Counter = function Counter({ start }) {",
        "  const [count, setCount] = useSignal(start);",
        "  const doubled = useMemo(() => count() * 2);",
        "  const inc = () => setCount(count() + 1);",
        "  useEffect(() => { document.title = String(doubled()); });",
        '  onMount(() => { console.log("mounted"); });',
        '  return <button class="btn" onClick={inc}>{count()} {doubled()}</button>;',
        "};",
        "export default Counter;",
        "",
      ].join("\n"),
    );
    expect(remaining).toEqual([]);
  });

  it("[ESL-93.2] migrating already migrated code changes nothing", () => {
    const once = migrate(react).output;
    const twice = migrate(once);
    expect(twice.output).toBe(once);
    expect(twice.remaining).toEqual([]);
  });

  it("[ESL-93.3] Solid names are renamed and components move to @shadow-js/web", () => {
    const solid = [
      'import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";',
      "",
      "export function Clock() {",
      "  const [now, setNow] = createSignal(0);",
      "  createEffect(() => {",
      "    const id = setInterval(() => setNow(now() + 1), 1000);",
      "    onCleanup(() => clearInterval(id));",
      "  });",
      "  return <Show when={now()} fallback={<i />}><For each={[1, 2]}>{(n) => <b>{n}</b>}</For></Show>;",
      "}",
      "",
    ].join("\n");
    const { output, remaining } = migrate(solid);
    expect(output).toContain('import { Show, For } from "@shadow-js/web";');
    expect(output).toContain('import { onCleanup, useSignal, useEffect } from "@shadow-js/core";');
    expect(output).toContain("const [now, setNow] = useSignal(0);");
    expect(output).toContain("useEffect(() => {");
    expect(output).not.toContain("solid-js");
    expect(remaining).toEqual([]);
  });

  it("[ESL-93.4] things that need a human stay reported", () => {
    const { remaining } = migrate(
      'import { useRef, useInsertionEffect } from "react";\nconst r = useRef(null);\nuseInsertionEffect(() => {});\n',
    );
    expect(remaining).toHaveLength(2);
    expect(remaining.every((message) => message.startsWith("shadow/no-react-patterns"))).toBe(true);
  });
});
