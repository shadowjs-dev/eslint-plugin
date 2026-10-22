import type { ESLint, Linter } from "eslint";
import { flatConfigs, type LegacyConfig, legacyConfigs } from "./configs/index";
import type { ShadowRule } from "./rule";
import { rules } from "./rules/index";

export type {
  ConfigName,
  LegacyConfig,
  RuleChange,
  RuleOverride,
  RuleOverrides,
  RuleSetting,
  Severity,
} from "./configs/index";
export { configure, LEVELS } from "./configs/index";
export type { ParseOptions, ParseResult, ShadowParser } from "./parser/index";
export { parser } from "./parser/index";
export type { RuleSpec, ShadowRule, ShadowRuleDocs } from "./rule";
export { defineRule } from "./rule";
export { rules } from "./rules/index";

/**
 * The plugin object: rules plus the shipped configs.
 *
 * @since 1.0.0
 */
export interface ShadowPlugin extends ESLint.Plugin {
  meta: { name: string; version: string; namespace: string };
  rules: Record<string, ShadowRule>;
  configs: {
    recommended: Linter.Config;
    strict: Linter.Config;
    migration: Linter.Config;
    dusk: Linter.Config;
    "legacy-recommended": LegacyConfig;
    "legacy-strict": LegacyConfig;
    "legacy-migration": LegacyConfig;
    "legacy-dusk": LegacyConfig;
  };
}

const placeholder: Linter.Config = { name: "shadow/pending" };
const emptyLegacy: LegacyConfig = {
  plugins: [],
  parser: "",
  parserOptions: { ecmaFeatures: { jsx: true } },
  rules: {},
};

/**
 * The `@shadow-js/eslint-plugin` plugin. Use the flat configs with ESLint 9 or 10:
 *
 * ```js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [shadow.configs.recommended];
 * ```
 *
 * `configs.strict` turns everything on; `configs.migration` is for code being ported from React or
 * Solid (it enables `shadow/no-react-patterns` with autofixes); `configs.dusk` is `recommended` for
 * a Dusk project. Every config sets the parser the plugin ships (`parser`), which parses
 * TypeScript and JSX without the TypeScript compiler API, so it runs on TypeScript 7. The `legacy-*`
 * configs are the same sets in eslintrc shape for ESLint 8.
 *
 * @example
 * // eslint.config.js
 * import shadow from "@shadow-js/eslint-plugin";
 * export default [shadow.configs.recommended, { rules: { "shadow/no-react-patterns": "off" } }];
 * @since 1.0.0
 */
const plugin: ShadowPlugin = {
  meta: { name: "@shadow-js/eslint-plugin", version: __VERSION__, namespace: "shadow" },
  rules: { ...rules },
  configs: {
    recommended: placeholder,
    strict: placeholder,
    migration: placeholder,
    dusk: placeholder,
    "legacy-recommended": emptyLegacy,
    "legacy-strict": emptyLegacy,
    "legacy-migration": emptyLegacy,
    "legacy-dusk": emptyLegacy,
  },
};

// The flat configs point back at the plugin, so they are created once the plugin object exists.
Object.assign(plugin.configs, flatConfigs(plugin), legacyConfigs());

export default plugin;
/**
 * The configs of the plugin: the same object as `plugin.configs`.
 *
 * @example
 * import { configs } from "@shadow-js/eslint-plugin";
 * export default [configs.recommended];
 * @since 1.0.0
 */
export const configs: ShadowPlugin["configs"] = plugin.configs;
