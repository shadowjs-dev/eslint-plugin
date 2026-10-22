import { describe, expect, it } from "vitest";
import { lintSource } from "../support/lint";

/**
 * The refusal threshold is 1,000 levels. The scan counts brackets and the tree walk counts levels below the program, and a
 * declaration adds a few levels around its value, so a bracket run a few short of 1,000 is already refused by the tree
 * walk. What is promised: well under 1,000 parses, 1,000 and more is a parse error with a message.
 */

function fatalsOf(code: string, filename = "deep.tsx"): string[] {
  return lintSource(code, filename)
    .filter((message) => message.fatal === true)
    .map((message) => message.message);
}

const TOO_DEEP = /^Parsing error: Code nests more than 1000 levels deep/;

describe("[ESL-105] the 1,000-level nesting limit has an exact edge", () => {
  it("[ESL-105.1] 990 nested brackets parse and lint with every rule", () => {
    const code = `const v = ${"[".repeat(990)}${"]".repeat(990)};`;
    expect(fatalsOf(code)).toEqual([]);
  });

  it("[ESL-105.2] 1,000 and 1,001 nested brackets are refused with the nesting message", () => {
    for (const depth of [1000, 1001]) {
      const fatals = fatalsOf(`const v = ${"[".repeat(depth)}${"]".repeat(depth)};`);
      expect(fatals, String(depth)).toHaveLength(1);
      expect(fatals[0]).toMatch(TOO_DEEP);
    }
  });

  it("[ESL-105.3] the bracket count is nesting, not total: 5,000 sibling pairs are fine", () => {
    const code = `const v = [${"[],".repeat(5000)}];`;
    expect(fatalsOf(code)).toEqual([]);
  });

  it("[ESL-105.4] elements nested 1,100 deep in JSX are refused with the message, not a crash", () => {
    const code = `export const A = () => ${"<div>".repeat(1100)}${"</div>".repeat(1100)};`;
    const fatals = fatalsOf(code);
    expect(fatals).toHaveLength(1);
    expect(fatals[0]).toMatch(TOO_DEEP);
  });

  it("[ESL-105.5] a nested ternary chain of 1,100 conditions is refused with the message", () => {
    const chain = Array.from({ length: 1100 }, (_, i) => `a${i} ? ${i} :`).join(" ");
    const fatals = fatalsOf(`const v = ${chain} 0;`);
    expect(fatals).toHaveLength(1);
    expect(fatals[0]).toMatch(TOO_DEEP);
  });

  it("[ESL-105.6] 300 nested JSX elements still lint with every rule", () => {
    const code = `export const A = () => ${"<div>".repeat(300)}x${"</div>".repeat(300)};`;
    expect(fatalsOf(code)).toEqual([]);
  });

  it("[ESL-105.7] the refusal is the same for .js and .ts files, so no file type bypasses it", () => {
    const code = `const v = ${"(".repeat(1001)}1${")".repeat(1001)};`;
    for (const filename of ["a.js", "a.ts", "a.jsx", "a.mts"]) {
      expect(fatalsOf(code, filename)[0], filename).toMatch(TOO_DEEP);
    }
  });
});
