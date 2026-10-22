import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Linter } from "eslint";
import * as espree from "espree";
import { describe, expect, it } from "vitest";
import { parserDeps } from "../../src/parser/deps";
import { parser } from "../../src/parser/index";
import { attachLocations, LineIndex } from "../../src/parser/locations";
import { tokenize } from "../../src/parser/tokens";
import { CORPUS } from "../support/corpus";
import { shadowParser, typescriptEslintParser } from "../support/tester";

interface Parsed {
  ast: Record<string, unknown> & { tokens: Token[]; comments: Comment[] };
  scopeManager: {
    globalScope: {
      childScopes: Array<{
        type: string;
        set: Map<string, { defs: Array<{ type: string }>; references: unknown[] }>;
      }>;
      references: Array<{ identifier: { name: string } }>;
    };
  };
  visitorKeys: Record<string, string[]>;
  services: Record<string, unknown>;
}
interface Token {
  type: string;
  value: string;
  range: [number, number];
  loc: { start: { line: number; column: number }; end: { line: number; column: number } };
}
interface Comment {
  type: string;
  value: string;
  range: [number, number];
}

function parse(code: string, filePath = "file.tsx", extra: Record<string, unknown> = {}): Parsed {
  const result: unknown = parser.parseForESLint(code, {
    filePath,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
    range: true,
    loc: true,
    tokens: true,
    comment: true,
    ...extra,
  });
  return result as Parsed;
}

describe("[ESL-95] the shipped parser needs no TypeScript", () => {
  it("[ESL-95.1] returns what ESLint needs: ast, tokens, comments, scope manager, keys, services", () => {
    const result = parse("// hi\nconst a: number = 1; /* b */\n");
    expect(result.ast["type"]).toBe("Program");
    expect(result.ast["range"]).toBeDefined();
    expect(result.ast["loc"]).toBeDefined();
    expect(result.ast.tokens.map((token) => token.value)).toEqual([
      "const",
      "a",
      ":",
      "number",
      "=",
      "1",
      ";",
    ]);
    expect(result.ast.comments.map((comment) => [comment.type, comment.value])).toEqual([
      ["Line", " hi"],
      ["Block", " b "],
    ]);
    expect(result.visitorKeys["TSTypeAnnotation"]).toEqual(["typeAnnotation"]);
    expect(result.scopeManager.globalScope).toBeDefined();
    // No program: rules that read types fall back to syntax (see utils/types.ts).
    expect(result.services["program"]).toBeNull();
  });

  it("[ESL-95.2] meta names the parser and the package version", () => {
    expect(parser.meta.name).toBe("@shadow-js/eslint-plugin/parser");
    expect(typeof parser.meta.version).toBe("string");
    expect(parser.parse("1;", { filePath: "a.js", sourceType: "module" })).toMatchObject({
      type: "Program",
    });
  });

  it("[ESL-95.3] the source of the plugin never imports typescript or typescript-eslint", () => {
    const root = join(import.meta.dirname, "..", "..", "src");
    const files: string[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const dir = pending.pop() as string;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) pending.push(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    }
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(
        /(?:from\s+|require\(\s*|import\(\s*)["'](?:typescript|@typescript-eslint\/(?:parser|typescript-estree|project-service|tsconfig-utils))["']/,
      );
    }
  });

  it("[ESL-95.4] a syntax error is reported the way ESLint expects (line, column, index)", () => {
    expect.assertions(4);
    try {
      parse("const a = ;\n", "bad.ts");
    } catch (error) {
      const failure = error as {
        message: string;
        lineNumber: number;
        column: number;
        index: number;
      };
      expect(failure.message.length).toBeGreaterThan(3);
      expect(failure.lineNumber).toBe(1);
      expect(failure.column).toBe(11);
      expect(failure.index).toBe(10);
    }
  });

  it("[ESL-95.5] the language follows the extension, and JSX follows ecmaFeatures", () => {
    // `<T>x` is a type assertion in .ts and JSX in .tsx / .jsx.
    expect(parse("const a = <T>x;", "a.ts", { ecmaFeatures: {} }).ast.tokens).toHaveLength(8);
    expect(() => parse("const a = <T>x;", "a.tsx")).toThrow();
    expect(() => parse("const a = <div />;", "a.js")).not.toThrow();
    expect(() => parse("const a = <div />;", "a.js", { ecmaFeatures: {} })).toThrow();
    expect(() => parse("export const a = 1;", "a.mts", { ecmaFeatures: {} })).not.toThrow();
    expect(() => parse("module.exports = {};", "a.cjs", { sourceType: "commonjs" })).not.toThrow();
    // Unknown names (stdin, `<input>`) parse as TSX: the widest grammar.
    expect(() => parse("const a: number = 1; const b = <p />;", "<input>")).not.toThrow();
  });

  it("[ESL-95.6] positions are UTF-16 offsets with LF, CRLF, CR and U+2028 line breaks", () => {
    const code = 'a;\r\nb;\rc;\u2028d;\n  "😀"; zé;';
    const result = parse(code, "a.ts");
    const found = result.ast.tokens.filter((token) => token.type === "Identifier");
    expect(
      found.map((token) => [token.value, token.loc.start.line, token.loc.start.column]),
    ).toEqual([
      ["a", 1, 0],
      ["b", 2, 0],
      ["c", 3, 0],
      ["d", 4, 0],
      ["zé", 5, 8],
    ]);
    expect(found.at(-1)?.loc.end).toEqual({ line: 5, column: 10 });
  });

  it("[ESL-95.7] the parser's own tree walks are iterative: 20000 chained terms do not overflow", () => {
    const code = `const x = ${Array.from({ length: 20_000 }, (_, i) => String(i)).join(" + ")};`;
    const { parseSync } = parserDeps();
    const result = parseSync("deep.ts", code, {
      lang: "ts",
      sourceType: "module",
      astType: "ts",
      range: true,
      preserveParens: false,
    });
    const program = result.program as object;
    const lines = new LineIndex(code);
    attachLocations(program, lines);
    const tokens = tokenize(code, program as Record<string, unknown>, result.comments, lines);
    expect(tokens).toHaveLength(3 + 20_000 + 19_999 + 1);
    expect(tokens.at(-1)?.loc.end).toEqual({ line: 1, column: code.length });
  });

  it("[ESL-95.8] JSX is never given a React pragma reference, and types are not value references", () => {
    const result = parse(
      'import { Show } from "@shadow-js/core";\nimport type { T } from "./t";\nconst a: T = <Show />;\n',
      "a.tsx",
    );
    const module = result.scopeManager.globalScope.childScopes.find((s) => s.type === "module");
    expect(module?.set.get("Show")?.defs[0]?.type).toBe("ImportBinding");
    expect(
      result.scopeManager.globalScope.references.some(
        (reference) => reference.identifier.name === "React",
      ),
    ).toBe(false);
  });

  it("[ESL-95.9] a hashbang line is a comment, as ESLint passes it on", () => {
    const result = parse("#!/usr/bin/env node\nconst a = 1;\n", "run.mjs", { ecmaFeatures: {} });
    expect(result.ast.tokens[0]?.value).toBe("const");
  });
});

/** Fields the two parsers disagree on without changing the meaning: `null` instead of absent. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof RegExp) return String(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (["start", "end", "parent", "loc", "hashbang", "tokens", "comments"].includes(key)) continue;
    const child: unknown = Reflect.get(value, key);
    if (child === undefined || child === null) continue;
    // Entities in JSX text and CR in template text are kept raw by one parser and decoded by the other.
    if (key === "value" && Reflect.get(value, "type") === "JSXText") continue;
    if (key === "raw" && Reflect.get(value, "type") === "TemplateElement") continue;
    if (key === "value" && Reflect.get(value, "type") === "TemplateElement") continue;
    // The enum member flag exists in the newer tree only.
    if (key === "computed" && Reflect.get(value, "type") === "TSEnumMember") continue;
    out[key] = normalize(child);
  }
  return out;
}

function parseWith(parserUnderTest: Linter.Parser, code: string, file: string): Parsed {
  const result: unknown = (
    parserUnderTest as unknown as {
      parseForESLint(code: string, options: Record<string, unknown>): unknown;
    }
  ).parseForESLint(code, {
    filePath: file,
    sourceType: "module",
    ecmaFeatures: { jsx: file.endsWith("x") || file.endsWith(".js") },
    range: true,
    loc: true,
    tokens: true,
    comment: true,
  });
  return result as Parsed;
}

describe("[ESL-96] the shipped parser agrees with typescript-eslint", () => {
  for (const [file, code] of CORPUS) {
    it(`[ESL-96.1] tokens of ${file} have the same types, values and positions`, () => {
      const ours = parseWith(shadowParser, code, file).ast.tokens;
      const theirs = parseWith(typescriptEslintParser, code, file).ast.tokens;
      // typescript-eslint types some names inside JSX as JSXIdentifier and some as Identifier
      // differently from espree (`{a.b}` children, `x:y` attributes); espree is the reference for
      // that distinction (see ESL-96.5), so here both count as one type.
      const show = (tokens: Token[]): string[] =>
        tokens.map(
          (token) =>
            `${token.type === "JSXIdentifier" ? "Identifier" : token.type} ${JSON.stringify(token.value)} ${token.range.join("-")} ${token.loc.start.line}:${token.loc.start.column}-${token.loc.end.line}:${token.loc.end.column}`,
        );
      expect(show(ours)).toEqual(show(theirs));
    });

    it(`[ESL-96.2] comments of ${file} agree`, () => {
      const ours = parseWith(shadowParser, code, file).ast.comments;
      const theirs = parseWith(typescriptEslintParser, code, file).ast.comments;
      expect(ours).toEqual(theirs);
    });

    it(`[ESL-96.3] the syntax tree of ${file} agrees`, () => {
      const ours = parseWith(shadowParser, code, file).ast;
      const theirs = parseWith(typescriptEslintParser, code, file).ast;
      expect(normalize(ours)).toEqual(normalize(theirs));
    });

    it(`[ESL-96.4] every node of ${file} carries range and loc inside the source`, () => {
      const ours = parseWith(shadowParser, code, file).ast;
      const pending: unknown[] = [ours];
      let nodes = 0;
      while (pending.length > 0) {
        const value = pending.pop();
        if (Array.isArray(value)) {
          pending.push(...value);
          continue;
        }
        if (typeof value !== "object" || value === null) continue;
        const type: unknown = Reflect.get(value, "type");
        if (typeof type === "string") {
          const range: unknown = Reflect.get(value, "range");
          const loc: unknown = Reflect.get(value, "loc");
          expect(Array.isArray(range), type).toBe(true);
          expect(loc, type).toBeDefined();
          const [start, end] = range as [number, number];
          expect(start >= 0 && end <= code.length && start <= end, type).toBe(true);
          nodes += 1;
        }
        for (const key of Object.keys(value)) {
          if (key === "parent" || key === "tokens" || key === "comments") continue;
          pending.push(Reflect.get(value, key));
        }
      }
      expect(nodes).toBeGreaterThan(0);
    });
  }
});

describe("[ESL-96] the shipped parser agrees with espree on JavaScript", () => {
  const sources: ReadonlyArray<readonly [string, string]> = [
    ...CORPUS.filter(([file]) => file.endsWith(".js")),
    [
      "j.jsx",
      'const el = <Foo.Bar a="1" b={x.y} c:d="e" {...rest}>\n  {/* c */}\n  {ok ? <i>1</i> : null}\n  text & more\n</Foo.Bar>;\nconst f = <></>;\n',
    ],
  ];
  for (const [file, code] of sources) {
    it(`[ESL-96.5] tokens of ${file} equal espree's, type by type`, () => {
      const ours = parseWith(shadowParser, code, file).ast.tokens;
      const reference = espree.parse(code, {
        ecmaVersion: "latest",
        sourceType: "module",
        tokens: true,
        range: true,
        loc: true,
        comment: true,
        ecmaFeatures: { jsx: true },
      });
      const show = (tokens: Token[]): string[] =>
        tokens.map(
          (token) =>
            `${token.type} ${JSON.stringify(token.value)} ${token.range.join("-")} ${token.loc.start.line}:${token.loc.start.column}-${token.loc.end.line}:${token.loc.end.column}`,
        );
      expect(show(ours)).toEqual(show((reference as unknown as { tokens: Token[] }).tokens));
    });
  }
});

function lintWith(
  code: string,
  rules: Linter.RulesRecord,
  file = "file.tsx",
): Linter.LintMessage[] {
  return new Linter({ configType: "flat" }).verify(
    code,
    [
      {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          parser: shadowParser,
          ecmaVersion: 2023,
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules,
      },
    ],
    { filename: file },
  );
}

describe("[ESL-97] core ESLint rules run on the shipped parser", () => {
  it("[ESL-97.1] rules that read tokens work (eqeqeq, no-extra-boolean-cast, no-multi-spaces, semi)", () => {
    const messages = lintWith("const a = 1;\nif (a == 2) { }\nif (!!a) { }\nconst c  = 3\n", {
      eqeqeq: "error",
      "no-extra-boolean-cast": "error",
      "no-multi-spaces": "error",
      semi: "error",
    });
    expect(messages.map((message) => message.ruleId).sort()).toEqual([
      "eqeqeq",
      "no-extra-boolean-cast",
      "no-multi-spaces",
      "semi",
    ]);
    expect(messages.find((message) => message.ruleId === "eqeqeq")).toMatchObject({
      line: 2,
      column: 7,
    });
  });

  it("[ESL-97.2] scope rules see imports, types and JSX (no-unused-vars, no-undef)", () => {
    const messages = lintWith(
      [
        'import { Show, unused } from "@shadow-js/core";',
        'import type { Props } from "./props";',
        "export function A(p: Props) { return <Show when={p.on}>{missing}</Show>; }",
      ].join("\n"),
      { "no-unused-vars": "error", "no-undef": "error" },
    );
    expect(messages.map((message) => `${message.ruleId}:${message.message}`)).toEqual([
      "no-unused-vars:'unused' is defined but never used.",
      "no-undef:'missing' is not defined.",
    ]);
  });

  it("[ESL-97.3] eslint-disable comments and comment rules work", () => {
    const messages = lintWith(
      "// eslint-disable-next-line eqeqeq\nconst a = 1 == 2;\nconst b = 1 == 2;\n",
      { eqeqeq: "error" },
    );
    expect(messages.map((message) => message.line)).toEqual([3]);
  });

  it("[ESL-97.4] a parse error is a fatal message with a position, not a crash", () => {
    const messages = lintWith("const = ;\n", {});
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ fatal: true, line: 1 });
    expect(messages[0]?.message).toMatch(/^Parsing error: /);
  });
});
