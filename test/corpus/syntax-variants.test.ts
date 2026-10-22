import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../../src/index";
import { parser } from "../../src/parser/index";
import { SYNTAX_VARIANTS } from "../support/syntax-variants";

const names = Object.keys(plugin.rules);

/** Every rule at `error`, the way the strict config runs them, with the given overrides. */
function allRules(extra: Record<string, Linter.RuleEntry> = {}): Linter.RulesRecord {
  const rules: Linter.RulesRecord = {};
  for (const name of names) rules[`shadow/${name}`] = "error";
  return { ...rules, ...extra };
}

/** Lints one file. A file that matches no configuration would run no rule at all: that is an error here. */
function lintAll(code: string, filename: string, rules: Linter.RulesRecord): Linter.LintMessage[] {
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(
    code,
    [
      {
        files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
        plugins: { shadow: plugin },
        languageOptions: {
          parser,
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules,
      },
    ],
    { filename },
  );
  expect(
    messages.filter((message) => message.message.startsWith("No matching configuration")),
    `${filename}: the rules did not run`,
  ).toEqual([]);
  return messages;
}

describe("[ESL-98] the syntax corpus lints without crashes or fatal errors", () => {
  it("[ESL-98.1] every variant parses with the shipped parser", () => {
    for (const [file, source] of SYNTAX_VARIANTS) {
      const fatal = lintAll(source, file, {}).filter((message) => message.fatal === true);
      expect(fatal, file).toEqual([]);
    }
  });

  it("[ESL-98.2] every rule runs over every variant without throwing", () => {
    for (const [file, source] of SYNTAX_VARIANTS) {
      expect(() => lintAll(source, file, allRules()), file).not.toThrow();
      expect(
        () =>
          lintAll(
            source,
            file,
            allRules({ "shadow/no-react-patterns": ["error", { frameworks: ["react", "solid"] }] }),
          ),
        file,
      ).not.toThrow();
    }
  });

  it("[ESL-98.3] ordinary syntax reports nothing under the recommended rules", () => {
    // These files use the forms correctly; a report here would be a false positive.
    const quiet = new Set([
      "using.ts",
      "enums.ts",
      "namespaces.ts",
      "import-attributes.ts",
      "type-only.ts",
      "types.ts",
      "classes.ts",
    ]);
    const recommended: Linter.RulesRecord = {};
    for (const name of names) {
      const level = plugin.configs.recommended.rules?.[`shadow/${name}`];
      if (level !== undefined) recommended[`shadow/${name}`] = level;
    }
    for (const [file, source] of SYNTAX_VARIANTS) {
      if (!quiet.has(file)) continue;
      expect(lintAll(source, file, recommended), file).toEqual([]);
    }
  });

  it("[ESL-98.4] decorators, satisfies and enums parse as the TypeScript parser does", () => {
    const decorated = SYNTAX_VARIANTS.find(([file]) => file === "decorators.ts")?.[1] ?? "";
    expect(lintAll(decorated, "decorators.ts", {}).filter((m) => m.fatal === true)).toEqual([]);
    expect(decorated).toContain("@log");
  });
});
