import { createRequire } from "node:module";

/** The slice of `oxc-parser`'s result the parser reads. */
export interface OxcResult {
  readonly program: unknown;
  readonly comments: ReadonlyArray<{
    readonly type: "Line" | "Block";
    readonly value: string;
    readonly start: number;
    readonly end: number;
  }>;
  readonly errors: ReadonlyArray<{
    readonly severity: string;
    readonly message: string;
    readonly labels: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  }>;
}

/** The options of `oxc-parser`'s `parseSync` the parser passes. */
export interface OxcOptions {
  readonly lang: "js" | "jsx" | "ts" | "tsx" | "dts";
  readonly sourceType: "script" | "module" | "commonjs";
  readonly astType: "ts";
  readonly range: true;
  readonly preserveParens: false;
}

/** The options of `@typescript-eslint/scope-manager`'s `analyze` the parser passes. */
export interface AnalyzeOptions {
  readonly childVisitorKeys: Readonly<Record<string, readonly string[]>>;
  readonly globalReturn: boolean;
  readonly impliedStrict: boolean;
  readonly jsxPragma: null;
  readonly jsxFragmentName: null;
  readonly lib: readonly string[];
  readonly sourceType: "script" | "module";
}

/** The third-party code the parser needs, loaded on the first parse. */
export interface ParserDeps {
  parseSync(filename: string, source: string, options: OxcOptions): OxcResult;
  analyze(program: unknown, options: AnalyzeOptions): unknown;
  readonly visitorKeys: Readonly<Record<string, readonly string[]>>;
}

let loaded: ParserDeps | undefined;

/**
 * Loads `oxc-parser`, `@typescript-eslint/scope-manager` and `@typescript-eslint/visitor-keys` the
 * first time something is parsed. The plugin object is imported by every ESLint run, including the
 * ones that use another parser; loading a native parser then would cost start-up time, and break the
 * plugin on a platform that has no binary for it. `require` of an ES module works on the Node
 * versions the package supports (22.12 and later).
 *
 * @returns The three modules' functions, cached after the first call.
 */
export function parserDeps(): ParserDeps {
  if (loaded !== undefined) return loaded;
  const requireHere = createRequire(import.meta.url);
  const oxc = requireHere("oxc-parser") as { parseSync: ParserDeps["parseSync"] };
  const scope = requireHere("@typescript-eslint/scope-manager") as {
    analyze: ParserDeps["analyze"];
  };
  const keys = requireHere("@typescript-eslint/visitor-keys") as {
    visitorKeys: ParserDeps["visitorKeys"];
  };
  loaded = { parseSync: oxc.parseSync, analyze: scope.analyze, visitorKeys: keys.visitorKeys };
  return loaded;
}
