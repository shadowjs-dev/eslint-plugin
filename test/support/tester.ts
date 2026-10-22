import Module, { createRequire } from "node:module";
import { type Linter, RuleTester } from "eslint";
import { describe, it } from "vitest";
import { parser as shadowParserModule } from "../../src/parser/index";
import type { ShadowRule } from "../../src/rule";

// This package compiles with TypeScript 7, which has no JavaScript API, and the shipped parser
// (`src/parser`) does not need one: every rule test runs with it. typescript-eslint needs the API
// of TypeScript <= 6, installed next to this package as a dev dependency, and is kept for two
// jobs only: the type-aware tests and a cross-check that the rules answer the same under both
// parsers. npm hoists `ts-api-utils` to the root, where a plain `require("typescript")` finds
// version 7, so tests route that one request to the copy installed for this package. Only this test
// support file does it; the shipped plugin never loads TypeScript.
const requireHere = createRequire(import.meta.url);
const typescript6 = requireHere.resolve("typescript");
const internals = Module as unknown as {
  _load(this: unknown, request: string, parent: unknown, isMain: boolean): unknown;
};
const originalLoad = internals._load;
internals._load = function load(this: unknown, request: string, parent: unknown, isMain: boolean) {
  return originalLoad.call(this, request === "typescript" ? typescript6 : request, parent, isMain);
};
// Loaded with `require` so the type checker (TypeScript 7) does not read the parser's declarations,
// which are written against the TypeScript 6 API.
const loadedParser: unknown = requireHere("@typescript-eslint/parser");
if (
  typeof loadedParser !== "object" ||
  loadedParser === null ||
  !("parseForESLint" in loadedParser)
) {
  throw new TypeError("@typescript-eslint/parser did not load");
}
/** The typescript-eslint parser (TypeScript 6 copy), for cross-checks and type-aware tests. */
export const typescriptEslintParser: Linter.Parser = loadedParser as Linter.Parser;
/** The parser the plugin ships, which runs on any TypeScript version. */
export const shadowParser: Linter.Parser = shadowParserModule as Linter.Parser;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it;

type Cases = Parameters<RuleTester["run"]>[2];
type ValidCase = Cases["valid"][number];
type InvalidCase = Cases["invalid"][number];

/** A valid case: a code string or a case object. */
export type Valid = string | Exclude<ValidCase, string>;
/** An invalid case. */
export type Invalid = InvalidCase;

const languageOptionsFor = (parser: Linter.Parser): Linter.LanguageOptions => ({
  parser,
  ecmaVersion: 2023,
  sourceType: "module",
  parserOptions: { ecmaFeatures: { jsx: true } },
});

function label(code: string): string {
  const line = code.trim().split("\n")[0] ?? "";
  return line.length > 56 ? `${line.slice(0, 56)}...` : line;
}

function suite(
  id: string,
  name: string,
  parser: Linter.Parser,
  title: string,
  rule: ShadowRule,
  cases: { valid: readonly Valid[]; invalid: readonly Invalid[] },
): void {
  const tester = new RuleTester({ languageOptions: languageOptionsFor(parser) });
  tester.run(`[${id}] ${name}${title}`, rule, {
    valid: cases.valid.map((entry, index) => {
      const base = typeof entry === "string" ? { code: entry } : entry;
      return {
        ...base,
        name: `[${id}.v${index + 1}] ${base.name ?? label(base.code)}`,
        filename: base.filename ?? "file.tsx",
      };
    }),
    invalid: cases.invalid.map((entry, index) => ({
      ...entry,
      name: `[${id}.i${index + 1}] ${entry.name ?? label(entry.code)}`,
      filename: entry.filename ?? "file.tsx",
    })),
  });
}

/**
 * Runs the ESLint rule tester over the cases with the parser the plugin ships, then once more with
 * typescript-eslint, so a rule cannot depend on one parser's quirks. Every case gets a name
 * `[<id>.v<n>]` / `[<id>.i<n>]` (the invariant id of the rule plus its position) and a `.tsx` file
 * name unless the case sets one.
 *
 * @param id Invariant id, such as `ESL-01`.
 * @param name Rule name for the suite title.
 * @param rule The rule under test.
 * @param cases The valid and invalid matrices.
 */
export function runRule(
  id: string,
  name: string,
  rule: ShadowRule,
  cases: { valid: readonly Valid[]; invalid: readonly Invalid[] },
): void {
  suite(id, name, shadowParser, "", rule, cases);
  suite(id, name, typescriptEslintParser, " (typescript-eslint)", rule, cases);
}

const typedRoot = new URL("../fixtures/typed/", import.meta.url).pathname;

/**
 * Like {@link runRule} but the parser builds a TypeScript program (the project service), so rules
 * can ask the type checker. Cases are checked against a stand-alone `tsconfig.json`.
 */
export function runTypedRule(
  id: string,
  name: string,
  rule: ShadowRule,
  cases: { valid: readonly Valid[]; invalid: readonly Invalid[] },
): void {
  const tester = new RuleTester({
    languageOptions: {
      ...languageOptionsFor(typescriptEslintParser),
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: typedRoot,
      },
    },
  });
  tester.run(`[${id}] ${name} (typed)`, rule, {
    valid: cases.valid.map((entry, index) => {
      const base = typeof entry === "string" ? { code: entry } : entry;
      return {
        ...base,
        name: `[${id}.tv${index + 1}] ${base.name ?? label(base.code)}`,
        filename: base.filename ?? `${typedRoot}file.tsx`,
      };
    }),
    invalid: cases.invalid.map((entry, index) => ({
      ...entry,
      name: `[${id}.ti${index + 1}] ${entry.name ?? label(entry.code)}`,
      filename: entry.filename ?? `${typedRoot}file.tsx`,
    })),
  });
}
