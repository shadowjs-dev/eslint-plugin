import { Linter } from "eslint";
import plugin from "../../src/index";
import { parser } from "../../src/parser/index";

/** Every rule the plugin ships, at `error`: the strict config, lint-wide. */
export function strictRules(): Linter.RulesRecord {
  const rules: Linter.RulesRecord = {};
  for (const name of Object.keys(plugin.rules)) rules[`shadow/${name}`] = "error";
  return rules;
}

/**
 * Lints one source with the shipped parser and the given rules. The file name matches the shipped
 * configs' `files` glob, so the rules run (a non-matching file would run none).
 */
export function lintSource(
  code: string,
  filename: string,
  rules: Linter.RulesRecord = strictRules(),
  cwd?: string,
): Linter.LintMessage[] {
  const linter = new Linter({ configType: "flat", ...(cwd === undefined ? {} : { cwd }) });
  return linter.verify(
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
}
