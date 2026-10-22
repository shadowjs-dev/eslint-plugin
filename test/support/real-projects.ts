import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Linter } from "eslint";
import plugin from "../../src/index";

export const SOURCE: RegExp = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".turbo", ".generated", "public"]);

/** The rules of the dusk preset, with their severities (the preset itself is what a project installs). */
export function duskRules(): Linter.RulesRecord {
  const rules: Linter.RulesRecord = {};
  for (const [name, entry] of Object.entries(plugin.configs.dusk.rules ?? {})) {
    if (entry !== undefined && entry !== null) rules[name] = entry as Linter.RuleEntry;
  }
  return rules;
}

/** The source files under `root` that the dusk preset lints (its ignores are applied here too). */
export function sourceFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (SOURCE.test(entry) && entry !== "routeTree.gen.ts") {
        out.push(path);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * The messages this test judges: the plugin's own rules and parse errors. ESLint core also reports
 * `Unused eslint-disable directive` when a generated file (Convex's `_generated`, which starts with
 * `/* eslint-disable *\/`) has nothing to silence; that is core ESLint, not a ShadowJS rule.
 */
export function judged(messages: Linter.LintMessage[]): Linter.LintMessage[] {
  return messages.filter(
    (message) => message.fatal === true || (message.ruleId?.startsWith("shadow/") ?? false),
  );
}

/** A message as `path:line rule severity message`, relative to the project root. */
export function describeMessage(root: string, file: string, message: Linter.LintMessage): string {
  const where = relative(root, file).split(sep).join("/");
  return `${where}:${message.line} ${message.ruleId ?? "fatal"} ${message.severity === 2 ? "error" : "warn"}`;
}
