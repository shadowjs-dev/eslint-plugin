import type { ESLint, Linter } from "eslint";
import {
  type ConfigName,
  flatConfigs,
  type LEVELS,
  type LegacyConfig,
  legacyConfigs,
  type RuleSetting,
} from "../src/configs/index";
import type { ParseResult, parser, ShadowParser } from "../src/parser/index";
import type { defineRule, RuleSpec, ShadowRule } from "../src/rule";
import type { rules } from "../src/rules/index";
import type { Equal, Expect } from "./support";

declare const plugin: ESLint.Plugin;

export type ConfigNameCheck = Expect<
  Equal<ConfigName, "recommended" | "strict" | "migration" | "dusk">
>;

export type RuleSettingCheck = Expect<
  Equal<
    RuleSetting,
    "off" | "warn" | "error" | readonly ["warn" | "error", Record<string, unknown>]
  >
>;

export type LevelsCheck = Expect<
  Equal<(typeof LEVELS)[string], Readonly<Record<ConfigName, RuleSetting>>>
>;

export type RuleTypeCheck = Expect<Equal<RuleSpec["type"], "problem" | "suggestion" | "layout">>;

export type RulesEntryCheck = Expect<Equal<(typeof rules)[string], ShadowRule>>;

export type DefineRuleReturnCheck = Expect<Equal<ReturnType<typeof defineRule>, ShadowRule>>;

export type ParserCheck = Expect<Equal<typeof parser, ShadowParser>>;

export type ParseResultServicesCheck = Expect<Equal<ParseResult["services"], { program: null }>>;

export type FlatConfigsCheck = Expect<
  Equal<ReturnType<typeof flatConfigs>, Record<ConfigName, Linter.Config>>
>;

export type LegacyConfigsCheck = Expect<
  Equal<ReturnType<typeof legacyConfigs>, Record<`legacy-${ConfigName}`, LegacyConfig>>
>;

export const recommendedFlat: Linter.Config = flatConfigs(plugin).recommended;

export const legacyRecommended: LegacyConfig = legacyConfigs()["legacy-recommended"];

// @ts-expect-error "legacy" is not a shipped config name
export const unknownConfig: unknown = flatConfigs(plugin).legacy;

// @ts-expect-error flat config keys are not legacy keys
export const flatKeyInLegacy: unknown = legacyConfigs()["recommended"];

// @ts-expect-error "fatal" is not a severity
export const badSetting: RuleSetting = "fatal";

// @ts-expect-error "bug" is not a rule type
export const badRuleType: RuleSpec["type"] = "bug";

// @ts-expect-error a parser program is null, not an object
export const badServices: ParseResult["services"] = { program: {} };
