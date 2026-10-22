import { describe, expect, it } from "vitest";
import { lintSource } from "../support/lint";

/** The longest identifier-like run the adversarial cases use: long enough to expose backtracking. */
const RUN = 50_000;
/** A pathological input must lint within this time. Linear rules take a few milliseconds. */
const LIMIT_MS = 3000;

function timedLint(code: string, filename = "redos.tsx"): { elapsed: number; fatal: number } {
  const start = performance.now();
  const messages = lintSource(code, filename);
  const elapsed = performance.now() - start;
  return { elapsed, fatal: messages.filter((message) => message.fatal === true).length };
}

describe("[ESL-100] identifier and pattern rules do not backtrack on adversarial input", () => {
  it("[ESL-100.1] a 50,000-character event name that almost matches `on...Capture` is linear", () => {
    // `^on([A-Z].*)Capture$` backtracks over the whole run before it fails: the input is built to end
    // one letter short of `Capture`.
    const name = `onA${"x".repeat(RUN)}Captur`;
    const result = timedLint(`const view = <div ${name}={handler} />;`);
    expect(result.fatal).toBe(0);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });

  it("[ESL-100.2] a long `on:` event namespace and value stay linear", () => {
    const name = `on:${"a-".repeat(RUN / 2)}b`;
    const result = timedLint(`const view = <input ${name}={handler} />;`);
    expect(result.fatal).toBe(0);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });

  it("[ESL-100.3] a javascript: URL padded with control characters is normalized in one pass", () => {
    const value = `java${"\t\u0001 ".repeat(RUN / 3)}script:alert(1)`;
    const result = timedLint(`const view = <a href="${value}">x</a>;`);
    expect(result.fatal).toBe(0);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });

  it("[ESL-100.4] a very long identifier that starts with a user-input name is matched once", () => {
    // The name is long, not deep: a chain of 50,000 members is refused by the parser's depth limit.
    const path = `userInput${"x".repeat(RUN)}.a`;
    const result = timedLint(`const view = <div {...${path}} />;`);
    expect(result.fatal).toBe(0);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });

  it("[ESL-100.5] a long attribute name with mixed casing of class and htmlFor is linear", () => {
    const attr = `classname${"Class".repeat(RUN / 5)}`;
    const result = timedLint(`const view = <div ${attr}="a" htmlFor="b" for="c" />;`);
    expect(result.fatal).toBe(0);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });

  it("[ESL-100.6] a long module specifier that looks like a server import is linear", () => {
    const specifier = `node:${"a/".repeat(RUN / 2)}fs`;
    const result = timedLint(`import x from "${specifier}";\nexport const y = x;`);
    expect(result.fatal).toBe(0);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });

  it("[ESL-100.7] a long component-like and hook-like name is classified without backtracking", () => {
    const hook = `use${"A".repeat(RUN)}`;
    const component = `A${"a".repeat(RUN)}_`;
    const result = timedLint(
      `function ${component}(props) { const v = ${hook}(); return <div>{v}{props.x}</div>; }`,
    );
    expect(result.fatal).toBe(0);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });
});

describe("[ESL-100] the rule ids and handler names that the rules check stay bounded", () => {
  it("[ESL-100.8] a 50,000-character string attribute value is not scanned more than once per rule", () => {
    const value = "y".repeat(RUN);
    const result = timedLint(`const view = <img alt="${value}" src="${value}" />;`);
    expect(result.elapsed).toBeLessThan(LIMIT_MS);
  });
});
