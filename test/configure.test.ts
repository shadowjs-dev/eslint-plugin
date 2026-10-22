import { readFileSync } from "node:fs";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { configs, configure } from "../src/index";

describe("[ESL-103] the Dusk ignores are one list for the flat and the legacy config", () => {
  it("[ESL-103.1] the flat dusk config and the legacy dusk config ignore exactly the same patterns", () => {
    // A drift between the two (one list edited, the other not) fails here.
    expect(configs["legacy-dusk"].ignorePatterns).toEqual(configs.dusk.ignores);
    expect(configs.dusk.ignores).toEqual(["**/dist/**", "**/routeTree.gen.ts"]);
  });

  it("[ESL-103.2] no other config, flat or legacy, carries an ignore list", () => {
    for (const name of ["recommended", "strict", "migration"] as const) {
      expect(configs[name].ignores, name).toBeUndefined();
      expect(configs[`legacy-${name}`].ignorePatterns, `legacy-${name}`).toBeUndefined();
    }
  });

  it("[ESL-103.3] the two lists are separate copies: changing one does not change the other", () => {
    expect(configs.dusk.ignores).not.toBe(configs["legacy-dusk"].ignorePatterns);
  });

  it("[ESL-103.4] a flat Dusk config skips a generated route tree and a built file, and lints the source", () => {
    const linter = new Linter({ configType: "flat" });
    const code = "const v = <div onClik={() => 1} />;";
    const rulesOf = (filename: string): string[] =>
      linter.verify(code, [configs.dusk], { filename }).map((message) => message.ruleId ?? "");
    // An ignored file gets no rule: ESLint only says that no configuration matches it.
    expect(rulesOf("src/routeTree.gen.ts")).toEqual([""]);
    expect(rulesOf("packages/web/dist/app.tsx")).toEqual([""]);
    expect(rulesOf("src/app.tsx")).toContain("shadow/valid-event-names");
  });

  it("[ESL-103.5] the README says the legacy dusk config ignores them too", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(readme).not.toContain("They do not add an ignore list");
  });
});

describe("[ESL-104] configure() changes the rules of a shipped config in one place", () => {
  it("[ESL-104.1] returns a new config and leaves the shipped one untouched", () => {
    const before = JSON.stringify(configs.recommended.rules);
    const custom = configure(configs.recommended, { "no-async-effect": "off" });
    expect(custom).not.toBe(configs.recommended);
    expect(custom.rules?.["shadow/no-async-effect"]).toBe("off");
    expect(JSON.stringify(configs.recommended.rules)).toBe(before);
    expect(configs.recommended.rules?.["shadow/no-async-effect"]).toBe("error");
  });

  it("[ESL-104.2] keeps everything else of the config: plugin, parser, files, ignores, and the other rules", () => {
    const custom = configure(configs.dusk, { "no-async-effect": "warn" });
    expect(custom.plugins).toBe(configs.dusk.plugins);
    expect(custom.languageOptions).toBe(configs.dusk.languageOptions);
    expect(custom.files).toEqual(configs.dusk.files);
    expect(custom.ignores).toEqual(configs.dusk.ignores);
    for (const [name, entry] of Object.entries(configs.dusk.rules ?? {})) {
      if (name === "shadow/no-async-effect") continue;
      expect(custom.rules?.[name], name).toEqual(entry);
    }
  });

  it("[ESL-104.3] a rule that the preset turns off is turned on with options in one entry", () => {
    expect(configs.recommended.rules?.["shadow/no-react-patterns"]).toBeUndefined();
    const custom = configure(configs.recommended, {
      "no-react-patterns": { severity: "warn", options: { frameworks: ["react"] } },
    });
    expect(custom.rules?.["shadow/no-react-patterns"]).toEqual(["warn", { frameworks: ["react"] }]);
  });

  it("[ESL-104.4] a severity alone keeps the options of the preset; options alone keep its severity", () => {
    const strict = configs.strict.rules?.["shadow/effect-cleanup-registered"];
    expect(strict).toEqual(["error", { checkTimeouts: true, checkAnimationFrames: true }]);
    const quieter = configure(configs.strict, {
      "effect-cleanup-registered": { severity: "warn" },
    });
    expect(quieter.rules?.["shadow/effect-cleanup-registered"]).toEqual([
      "warn",
      { checkTimeouts: true, checkAnimationFrames: true },
    ]);
    const narrower = configure(configs.strict, {
      "effect-cleanup-registered": { options: { checkTimeouts: false } },
    });
    expect(narrower.rules?.["shadow/effect-cleanup-registered"]).toEqual([
      "error",
      { checkTimeouts: false, checkAnimationFrames: true },
    ]);
  });

  it("[ESL-104.5] the array form replaces the options, as ESLint does", () => {
    const custom = configure(configs.strict, {
      "effect-cleanup-registered": ["warn", { checkTimeouts: false }],
    });
    expect(custom.rules?.["shadow/effect-cleanup-registered"]).toEqual([
      "warn",
      { checkTimeouts: false },
    ]);
  });

  it("[ESL-104.6] a rule can be turned off and later turned on again by configuring the result", () => {
    const off = configure(configs.strict, { "no-async-effect": "off" });
    expect(off.rules?.["shadow/no-async-effect"]).toBe("off");
    const on = configure(off, { "no-async-effect": { severity: "error" } });
    expect(on.rules?.["shadow/no-async-effect"]).toBe("error");
  });

  it("[ESL-104.7] a legacy config is configured with its own namespace and keeps its shape", () => {
    const custom = configure(configs["legacy-dusk"], {
      "no-async-effect": "off",
      "no-react-patterns": { severity: "warn" },
    });
    expect(custom.rules["@shadow-js/no-async-effect"]).toBe("off");
    expect(custom.rules["@shadow-js/no-react-patterns"]).toBe("warn");
    expect(custom.plugins).toEqual(["@shadow-js"]);
    expect(custom.parser).toBe("@shadow-js/eslint-plugin/parser");
    expect(custom.ignorePatterns).toEqual(configs["legacy-dusk"].ignorePatterns);
    expect(configs["legacy-dusk"].rules["@shadow-js/no-async-effect"]).toBe("error");
  });

  it("[ESL-104.8] the full rule name, with its namespace, is accepted too", () => {
    const custom = configure(configs.recommended, {
      "shadow/no-async-effect": "off",
      "no-write-in-memo": "warn",
    });
    expect(custom.rules?.["shadow/no-async-effect"]).toBe("off");
    expect(custom.rules?.["shadow/no-write-in-memo"]).toBe("warn");
  });

  it("[ESL-104.9] an unknown rule name is a TypeError that names it and suggests the nearest rule", () => {
    expect(() => configure(configs.recommended, { "no-async-efect": "off" })).toThrow(
      /unknown rule "no-async-efect".*no-async-effect/,
    );
    expect(() => configure(configs.recommended, { "other/rule": "off" })).toThrow(TypeError);
  });

  it("[ESL-104.10] a bad severity, a bad options value or an empty change is a TypeError", () => {
    const bad = (rules: Record<string, unknown>): unknown =>
      configure(configs.recommended, rules as never);
    expect(() => bad({ "no-async-effect": "fatal" })).toThrow(/severity/);
    expect(() => bad({ "no-async-effect": { severity: 3 } })).toThrow(/severity/);
    expect(() => bad({ "no-react-patterns": { options: "x" } })).toThrow(/options/);
    expect(() => bad({ "no-async-effect": {} })).toThrow(/severity or options/);
    expect(() => bad({ "no-async-effect": 5 })).toThrow(TypeError);
  });

  it("[ESL-104.11] options without a severity on a rule the preset has off is refused, with the way out", () => {
    expect(() =>
      configure(configs.recommended, {
        "no-react-patterns": { options: { frameworks: ["react"] } },
      }),
    ).toThrow(/is off in this config.*severity/);
  });

  it("[ESL-104.12] a configured config lints: the rule that was off now reports, with the options given", () => {
    const code = 'import { useState } from "react";\nexport const A = () => <p>{useState(0)}</p>;';
    const linter = new Linter({ configType: "flat" });
    const run = (config: Linter.Config): string[] =>
      linter.verify(code, [config], { filename: "a.tsx" }).map((m) => m.ruleId ?? "");
    expect(run(configs.recommended)).not.toContain("shadow/no-react-patterns");
    const custom = configure(configs.recommended, {
      "no-react-patterns": { severity: "error", options: { frameworks: ["react"] } },
    });
    expect(run(custom)).toContain("shadow/no-react-patterns");
  });
});
