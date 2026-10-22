import { describe, expect, it } from "vitest";
import { lintSource } from "../support/lint";

/**
 * Deeply nested source is a parse error, never a crash. `oxc-parser` segfaults near 5,000 nested
 * brackets (the process dies), and the scope analysis and ESLint's traversal overflow the JavaScript
 * stack on deep trees; the shipped parser refuses such sources before they reach them.
 */

function fatalsOf(code: string, filename = "deep.tsx"): string[] {
  return lintSource(code, filename)
    .filter((message) => message.fatal === true)
    .map((message) => message.message);
}

const TOO_DEEP = /nests more than 1000 levels deep/;

describe("[ESL-101] deep nesting is a parse error, not a crash", () => {
  it("[ESL-101.1] 900 chained operators parse and lint with every rule", () => {
    const chain = Array.from({ length: 900 }, (_, i) => `a${i}`).join(" + ");
    expect(fatalsOf(`const total = ${chain};`)).toEqual([]);
  });

  it("[ESL-101.2] 5,000 nested arrays are refused before the native parser runs", () => {
    const code = `const v = ${"[".repeat(5000)}${"]".repeat(5000)};`;
    const fatals = fatalsOf(code);
    expect(fatals).toHaveLength(1);
    expect(fatals[0]).toMatch(TOO_DEEP);
  });

  it("[ESL-101.3] 20,000 nested objects and parentheses are refused, not a segmentation fault", () => {
    expect(fatalsOf(`const v = ${"{a:".repeat(20_000)}1${"}".repeat(20_000)};`)[0]).toMatch(
      TOO_DEEP,
    );
    expect(fatalsOf(`const v = ${"(".repeat(20_000)}1${")".repeat(20_000)};`)[0]).toMatch(TOO_DEEP);
  });

  it("[ESL-101.4] a 5,000-term operator chain is refused with a message, not a stack overflow", () => {
    const chain = Array.from({ length: 5000 }, (_, i) => `a${i}`).join(" + ");
    const fatals = fatalsOf(`const total = ${chain};`);
    expect(fatals).toHaveLength(1);
    expect(fatals[0]).toMatch(TOO_DEEP);
    expect(fatals[0]).not.toMatch(/call stack/i);
  });

  it("[ESL-101.5] a 5,000-deep member chain is refused with a message", () => {
    const member = `userInput${".a".repeat(5000)}`;
    const fatals = fatalsOf(`const v = ${member};`);
    expect(fatals).toHaveLength(1);
    expect(fatals[0]).toMatch(TOO_DEEP);
  });

  it("[ESL-101.6] the error has a position inside the file, as a parse error does", () => {
    const code = `const v = ${"[".repeat(5000)}${"]".repeat(5000)};`;
    const messages = lintSource(code, "deep.tsx").filter((message) => message.fatal === true);
    expect(messages[0]?.line).toBe(1);
    expect(messages[0]?.column).toBeGreaterThan(0);
  });

  it("[ESL-101.7] deep nesting inside a string is counted too: the check is stricter, never looser", () => {
    // The scan does not look at token types, so a long run of brackets in a string is refused too.
    const code = `const s = "${"(".repeat(5000)}";`;
    expect(fatalsOf(code)[0]).toMatch(TOO_DEEP);
  });
});
