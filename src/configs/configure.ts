import type { Linter } from "eslint";
import type { LegacyConfig } from "./index";
import { LEVELS } from "./levels";
import { LEGACY_NAMESPACE, PLUGIN_NAMESPACE } from "./namespaces";

/**
 * A rule severity as a word.
 *
 * @since 1.0.0
 */
export type Severity = "off" | "warn" | "error";

/**
 * A change to one rule: the severity, the options, or both. A part that is left out stays as the
 * config has it. The options are merged over the config's options (shallow), so one option can change
 * while the others stay.
 *
 * @since 1.0.0
 */
export interface RuleChange {
  /** The new severity. Left out, the config's severity stays (an error when the config has the rule off). */
  readonly severity?: Severity | 0 | 1 | 2;
  /** Options merged over the config's options for the rule. */
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * What {@link configure} accepts for one rule: a severity word (the config's options stay), a
 * {@link RuleChange}, or an ESLint array `[severity, ...options]` that replaces the whole entry.
 *
 * @since 1.0.0
 */
export type RuleOverride = Severity | RuleChange | readonly [Severity | 0 | 1 | 2, ...unknown[]];

/**
 * Overrides keyed by rule name, with or without the namespace (`no-async-effect` or `shadow/no-async-effect`).
 *
 * @since 1.0.0
 */
export type RuleOverrides = Readonly<Record<string, RuleOverride>>;

const SEVERITY_WORDS: readonly Severity[] = ["off", "warn", "error"];

function severityOf(value: unknown): Severity | undefined {
  if (value === 0) return "off";
  if (value === 1) return "warn";
  if (value === 2) return "error";
  return SEVERITY_WORDS.find((word) => word === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The edit distance of two short names, for the "did you mean" part of an unknown rule message. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The short name of a rule key, or a TypeError that names the key and the nearest rule. */
function ruleNameOf(key: string, namespace: string): string {
  const name = key.startsWith(`${namespace}/`) ? key.slice(namespace.length + 1) : key;
  if (Object.hasOwn(LEVELS, name)) return name;
  const nearest = Object.keys(LEVELS)
    .map((candidate) => [candidate, distance(name, candidate)] as const)
    .sort((left, right) => left[1] - right[1])[0];
  const hint = nearest !== undefined && nearest[1] <= 3 ? ` Did you mean "${nearest[0]}"?` : "";
  throw new TypeError(`configure(): unknown rule "${key}".${hint}`);
}

/** The severity and options a config has for a rule; `off` and no options when it does not list it. */
function currentOf(entry: Linter.RuleEntry | undefined): {
  readonly severity: Severity;
  readonly options: readonly unknown[];
} {
  if (entry === undefined) return { severity: "off", options: [] };
  if (Array.isArray(entry)) {
    return { severity: severityOf(entry[0]) ?? "off", options: entry.slice(1) as unknown[] };
  }
  return { severity: severityOf(entry) ?? "off", options: [] };
}

/** The entry that results from one override applied to what the config has. */
function entryFor(
  key: string,
  override: unknown,
  entry: Linter.RuleEntry | undefined,
): Linter.RuleEntry {
  if (Array.isArray(override)) {
    const severity = severityOf(override[0]);
    if (severity === undefined) {
      throw new TypeError(
        `configure(): the severity of "${key}" must be "off", "warn" or "error" (got ${JSON.stringify(override[0])}).`,
      );
    }
    return [severity, ...override.slice(1)] as Linter.RuleEntry;
  }
  const change: Record<string, unknown> | undefined =
    typeof override === "string"
      ? { severity: override }
      : isRecord(override)
        ? override
        : undefined;
  if (change === undefined) {
    throw new TypeError(
      `configure(): the override of "${key}" must be a severity, an array or an object (got ${JSON.stringify(override)}).`,
    );
  }
  const { severity: given, options } = change;
  if (given === undefined && options === undefined) {
    throw new TypeError(`configure(): the override of "${key}" needs a severity or options.`);
  }
  if (options !== undefined && !isRecord(options)) {
    throw new TypeError(`configure(): the options of "${key}" must be an object.`);
  }
  const current = currentOf(entry);
  let severity = current.severity;
  if (given !== undefined) {
    const parsed = severityOf(given);
    if (parsed === undefined) {
      throw new TypeError(
        `configure(): the severity of "${key}" must be "off", "warn" or "error" (got ${JSON.stringify(given)}).`,
      );
    }
    severity = parsed;
  } else if (severity === "off") {
    throw new TypeError(
      `configure(): "${key}" is off in this config, so options alone cannot apply: give a severity too.`,
    );
  }
  if (severity === "off") return "off";
  if (options === undefined) {
    return current.options.length === 0
      ? severity
      : ([severity, ...current.options] as Linter.RuleEntry);
  }
  const [first, ...rest] = current.options;
  const merged = isRecord(first) ? { ...first, ...options } : { ...options };
  return [severity, merged, ...rest] as Linter.RuleEntry;
}

/**
 * Applies rule changes to a shipped config and returns a new config; the shipped one is not touched.
 * A preset cannot otherwise turn a rule off, or on with options, in one place: ESLint keeps the options
 * of an earlier config when a later one gives a severity alone, and replaces them when it gives an
 * array. This helper makes both explicit. It works on the flat configs (`shadow/<rule>`) and on the
 * `legacy-*` configs (`@shadow-js/<rule>`), and the result can be configured again.
 *
 * - A severity word (`"warn"`, `"off"`) changes the severity and keeps the config's options.
 * - `{ severity, options }` changes either or both. `options` are merged over the config's options for
 *   that rule (shallow). A rule the config has off needs a `severity` to turn it on.
 * - `["error", { ... }]` replaces the whole entry, as in an ESLint config.
 *
 * @param base A config from `plugin.configs`, or the result of an earlier `configure`.
 * @param overrides Rule changes keyed by rule name, with or without the namespace.
 * @returns A copy of `base` with the changed rules.
 * @throws TypeError for an unknown rule (the message names the nearest one), a severity that is not
 * `off`, `warn` or `error`, options that are not an object, an empty change, or options alone for a rule the config has off.
 * @example
 * import shadow, { configure } from "@shadow-js/eslint-plugin";
 *
 * export default [
 *   configure(shadow.configs.strict, {
 *     "no-async-effect": "warn",
 *     "effect-cleanup-registered": { options: { checkTimeouts: false } },
 *     "no-react-patterns": { severity: "warn", options: { frameworks: ["react"] } },
 *   }),
 * ];
 * @since 1.0.0
 */
export function configure<C extends Linter.Config | LegacyConfig>(
  base: C,
  overrides: RuleOverrides,
): C {
  const legacy = "parser" in base && typeof base.parser === "string";
  const namespace = legacy ? LEGACY_NAMESPACE : PLUGIN_NAMESPACE;
  const rules: Record<string, Linter.RuleEntry> = {
    ...(base.rules as Record<string, Linter.RuleEntry> | undefined),
  };
  for (const [key, override] of Object.entries(overrides)) {
    const name = ruleNameOf(key, namespace);
    const full = `${namespace}/${name}`;
    rules[full] = entryFor(key, override, rules[full]);
  }
  return { ...base, rules };
}
