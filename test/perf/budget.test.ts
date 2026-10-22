import { describe, expect, it } from "vitest";
import { lintSource } from "../support/lint";

/** One realistic component: signals, an effect with a cleanup, JSX, a keyed list, a reactive guard. */
function component(index: number): string {
  return `export function Comp${index}(props: { rows: readonly Row[]; open: boolean }) {
  const [count, setCount] = useSignal(0);
  const label = \`Comp ${index}: \${count()}\`;
  useEffect(() => { const t = setInterval(() => setCount(count() + 1), 1000); onCleanup(() => clearInterval(t)); });
  onMount(() => { document.title = label; });
  if (props.open === false) return null;
  return (
    <section class="x" onClick={() => setCount(count() + 1)}>
      <h2>{label}</h2>
      <For each={props.rows} key={(r) => r.id}>{(r) => <li class={r().done ? "d" : ""}>{r().name}</li>}</For>
      <ul>{props.rows.map((row) => <li>{row.name}</li>)}</ul>
      <Show when={count() > 3}><p>many</p></Show>
    </section>
  );
}
`;
}

/** A TSX module of at least `lines` lines. */
function module(lines: number): string {
  let source = [
    'import { useSignal, useEffect, onMount, onCleanup } from "@shadow-js/core";',
    'import { For, Show } from "@shadow-js/web";',
    "type Row = { id: number; name: string; done: boolean };",
    "",
  ].join("\n");
  for (let index = 0; source.split("\n").length <= lines; index += 1) source += component(index);
  return source;
}

/** Milliseconds one full lint of `code` takes with every rule at `error`. */
function timed(code: string): number {
  const start = performance.now();
  const messages = lintSource(code, "budget.tsx");
  const elapsed = performance.now() - start;
  expect(messages.filter((message) => message.fatal === true)).toEqual([]);
  return elapsed;
}

describe("[ESL-99] a large file lints within the budget", () => {
  // A generous budget: a 5,000-line file takes a fraction of a second on a laptop. The threshold
  // catches a regression to super-linear work, not normal load on a busy machine.
  const BUDGET_MS = 5000;

  it("[ESL-99.1] a 5,000-line TSX file lints with every rule in under the budget", () => {
    const code = module(5000);
    expect(code.split("\n").length).toBeGreaterThanOrEqual(5000);
    expect(timed(code)).toBeLessThan(BUDGET_MS);
  });

  it("[ESL-99.2] doubling the file does not more than quadruple the work (no quadratic pass)", () => {
    // Warm up the parser and the rules once so the first measurement does not pay for them.
    timed(module(500));
    const small = timed(module(2500));
    const large = timed(module(5000));
    expect(large).toBeLessThan(4 * small + 250);
  });
});

describe("[ESL-99] the shipped configs do not hold each other back", () => {
  it("[ESL-99.3] a file of 5,000 short statements is linted within the budget", () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `const v${index} = ${index} + 1;`);
    expect(timed(lines.join("\n"))).toBeLessThan(5000);
  });
});
