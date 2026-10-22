/**
 * A rule's setting in one config: a severity or `[severity, options]`.
 *
 * @since 1.0.0
 */
export type RuleSetting =
  | "off"
  | "warn"
  | "error"
  | readonly ["warn" | "error", Record<string, unknown>];

/**
 * The four shipped configs.
 *
 * @since 1.0.0
 */
export type ConfigName = "recommended" | "strict" | "migration" | "dusk";

/** The configs whose severities are written out in {@link LEVELS}; `dusk` is derived from `recommended`. */
type BaseConfigName = Exclude<ConfigName, "dusk">;

/**
 * Severity (and options) of every rule per config. This table is the single source for the flat
 * configs, the legacy configs and the generated docs.
 *
 * - `recommended`: safe defaults for ShadowJS code.
 * - `strict`: everything on, hooks must be unconditional, every timer/frame needs a cleanup.
 * - `migration`: for code being ported from React or Solid; the porting rule is on with autofixes.
 * - `dusk`: `recommended` for a Dusk project, with the server/client rule pinned to the
 *   Dusk boundary (see `DUSK_OVERRIDES`).
 */
const BASE_LEVELS: Readonly<Record<string, Readonly<Record<BaseConfigName, RuleSetting>>>> = {
  "no-destructure-props-outside-forgiving": {
    recommended: "warn",
    strict: ["error", { autoReactive: true }],
    migration: "warn",
  },
  "signal-must-be-called": { recommended: "error", strict: "error", migration: "error" },
  "no-write-in-memo": { recommended: "error", strict: "error", migration: "error" },
  "no-signal-write-in-render-body": { recommended: "warn", strict: "error", migration: "warn" },
  "effect-cleanup-registered": {
    recommended: "warn",
    strict: ["error", { checkTimeouts: true, checkAnimationFrames: true }],
    migration: "warn",
  },
  "no-async-effect": { recommended: "error", strict: "error", migration: "error" },
  "hooks-in-owner": {
    recommended: "warn",
    strict: ["error", { conditional: true }],
    migration: "warn",
  },
  "prefer-show-for-early-return": { recommended: "warn", strict: "error", migration: "warn" },
  "no-react-patterns": {
    recommended: "off",
    strict: "error",
    migration: ["error", { frameworks: ["react", "solid"] }],
  },
  "jsx-no-script-url": { recommended: "error", strict: "error", migration: "error" },
  "jsx-no-unsafe-inner-html": { recommended: "error", strict: "error", migration: "error" },
  "no-unsafe-spread-user-input": { recommended: "warn", strict: "error", migration: "warn" },
  "for-key-required-for-reorder": { recommended: "warn", strict: "error", migration: "warn" },
  "no-unkeyed-dynamic-list": { recommended: "warn", strict: "error", migration: "warn" },
  "server-only-import-in-client": { recommended: "error", strict: "error", migration: "error" },
  "valid-event-names": { recommended: "error", strict: "error", migration: "error" },
  "no-lowercase-dom-attrs-casing": {
    recommended: "warn",
    strict: ["error", { enforce: true }],
    migration: "off",
  },
  "no-physical-direction-classes": { recommended: "off", strict: "error", migration: "off" },
};

/** Where a Dusk project's rule settings differ from `recommended`. */
const DUSK_OVERRIDES: Readonly<Record<string, RuleSetting>> = {
  "server-only-import-in-client": ["error", { preset: "dusk" }],
};

/**
 * Severity (and options) of every rule per config, `dusk` included.
 *
 * @example
 * const strict = LEVELS["no-async-effect"]?.strict; // "error"
 * @since 1.0.0
 */
export const LEVELS: Readonly<Record<string, Readonly<Record<ConfigName, RuleSetting>>>> =
  Object.fromEntries(
    Object.entries(BASE_LEVELS).map(([name, levels]) => [
      name,
      { ...levels, dusk: DUSK_OVERRIDES[name] ?? levels.recommended },
    ]),
  );
