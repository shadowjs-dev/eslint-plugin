import type { ESLint, Linter } from "eslint";
import { parser } from "../parser/index";
import { type ConfigName, LEVELS, type RuleSetting } from "./levels";
import { LEGACY_NAMESPACE, PLUGIN_NAMESPACE } from "./namespaces";

export type { RuleChange, RuleOverride, RuleOverrides, Severity } from "./configure";
export { configure } from "./configure";
export type { ConfigName, RuleSetting } from "./levels";
export { LEVELS } from "./levels";
export { LEGACY_NAMESPACE, PLUGIN_NAMESPACE } from "./namespaces";

/**
 * The legacy (eslintrc) shape of a config.
 *
 * @since 1.0.0
 */
export interface LegacyConfig {
  plugins: string[];
  /** The parser as a module name, the way eslintrc loads it. */
  parser: string;
  parserOptions: { ecmaFeatures: { jsx: true } };
  rules: Record<string, Linter.RuleEntry>;
  /** Files the config never lints (eslintrc `ignorePatterns`); only `legacy-dusk` sets it. */
  ignorePatterns?: string[];
}

const NAMES: readonly ConfigName[] = ["recommended", "strict", "migration", "dusk"];

/** The parser as an eslintrc `parser` value (the module is a package export). */
const LEGACY_PARSER = "@shadow-js/eslint-plugin/parser";

/**
 * Files a Dusk project generates or builds; linting them only produces noise. The one list behind the flat
 * `dusk` config (`ignores`) and the legacy one (`ignorePatterns`), so the two cannot drift.
 */
const DUSK_IGNORES: readonly string[] = ["**/dist/**", "**/routeTree.gen.ts"];

function entryOf(setting: RuleSetting): Linter.RuleEntry {
  if (typeof setting === "string") return setting;
  const [severity, options] = setting;
  return [severity, options];
}

/**
 * Rule entries for one config, prefixed with `namespace`.
 *
 * @example
 * rulesFor("recommended", "shadow")["shadow/no-async-effect"]; // "error"
 * @since 1.0.0
 */
export function rulesFor(config: ConfigName, namespace: string): Record<string, Linter.RuleEntry> {
  const out: Record<string, Linter.RuleEntry> = {};
  for (const [name, levels] of Object.entries(LEVELS)) {
    const setting = levels[config];
    if (setting === "off") continue;
    out[`${namespace}/${name}`] = entryOf(setting);
  }
  return out;
}

/**
 * The flat configs, `recommended`, `strict`, `migration` and `dusk`, bound to `plugin`. Each sets
 * the parser the plugin ships, which needs no TypeScript: put another parser after the config to
 * replace it.
 *
 * @example
 * const { recommended, strict } = flatConfigs(plugin);
 * export default [recommended];
 * @since 1.0.0
 */
export function flatConfigs(plugin: ESLint.Plugin): Record<ConfigName, Linter.Config> {
  const build = (config: ConfigName): Linter.Config => ({
    name: `shadow/${config}`,
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
    ...(config === "dusk" ? { ignores: [...DUSK_IGNORES] } : {}),
    plugins: { [PLUGIN_NAMESPACE]: plugin },
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: rulesFor(config, PLUGIN_NAMESPACE),
  });
  return {
    recommended: build("recommended"),
    strict: build("strict"),
    migration: build("migration"),
    dusk: build("dusk"),
  };
}

/**
 * The same four configs in eslintrc shape (`extends: ["plugin:@shadow-js/legacy-recommended"]`).
 *
 * @example
 * const legacy = legacyConfigs()["legacy-recommended"]; // plugins: ["@shadow-js"]
 * @since 1.0.0
 */
export function legacyConfigs(): Record<`legacy-${ConfigName}`, LegacyConfig> {
  const build = (config: ConfigName): LegacyConfig => ({
    plugins: [LEGACY_NAMESPACE],
    parser: LEGACY_PARSER,
    parserOptions: { ecmaFeatures: { jsx: true } },
    rules: rulesFor(config, LEGACY_NAMESPACE),
    ...(config === "dusk" ? { ignorePatterns: [...DUSK_IGNORES] } : {}),
  });
  return {
    "legacy-recommended": build("recommended"),
    "legacy-strict": build("strict"),
    "legacy-migration": build("migration"),
    "legacy-dusk": build("dusk"),
  };
}

export { NAMES as CONFIG_NAMES };
