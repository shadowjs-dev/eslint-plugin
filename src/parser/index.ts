import { parserDeps } from "./deps";
import { attachLocations, LineIndex } from "./locations";
import { bracketOverflow, deepNode, MAX_NESTING, startOf } from "./nesting";
import { type RawNode, tokenize } from "./tokens";

/**
 * Options ESLint passes to a parser (`languageOptions` and `parserOptions` merged).
 *
 * @since 1.0.0
 */
export interface ParseOptions {
  filePath?: string;
  sourceType?: "script" | "module" | "commonjs";
  ecmaFeatures?: { jsx?: boolean };
  [key: string]: unknown;
}

/**
 * What `parseForESLint` returns.
 *
 * @since 1.0.0
 */
export interface ParseResult {
  /** The `Program` node, with `tokens`, `comments`, `range` and `loc`. */
  ast: Record<string, unknown>;
  /** Parser services. `program` is `null`: this parser builds no TypeScript program. */
  services: { program: null };
  /** Scopes and references, with TypeScript's type scopes (`@typescript-eslint/scope-manager`). */
  scopeManager: unknown;
  /** Child keys of every node type, for ESLint's traversal. */
  visitorKeys: Readonly<Record<string, readonly string[]>>;
}

/**
 * The parser object: use it as `languageOptions.parser`.
 *
 * @since 1.0.0
 */
export interface ShadowParser {
  meta: { name: string; version: string };
  parse(code: string, options?: ParseOptions): Record<string, unknown>;
  parseForESLint(code: string, options?: ParseOptions): ParseResult;
}

type Language = "js" | "jsx" | "ts" | "tsx" | "dts";

/** JavaScript sources are JSX only when `ecmaFeatures.jsx` says so; names ESLint invents are TSX. */
function languageOf(filePath: string, jsx: boolean): Language {
  if (/\.d\.[cm]?ts$/i.test(filePath)) return "dts";
  const dot = filePath.lastIndexOf(".");
  const extension = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
  switch (extension) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return jsx ? "jsx" : "js";
    default:
      return "tsx";
  }
}

/** Throws the way an ESLint parser does: an error with `lineNumber`, 1-based `column` and `index`. */
function fail(message: string, index: number, lines: LineIndex): never {
  const { line, column } = lines.position(index);
  throw Object.assign(new SyntaxError(message), { lineNumber: line, column: column + 1, index });
}

/** The parse error for a source nested beyond `MAX_NESTING` (see `nesting.ts`). */
const TOO_DEEP = `Code nests more than ${MAX_NESTING} levels deep (brackets, operators or elements): split it into smaller expressions.`;

function parseForESLint(code: string, options: ParseOptions = {}): ParseResult {
  const deps = parserDeps();
  const filePath = typeof options.filePath === "string" ? options.filePath : "<input>";
  const sourceType = options.sourceType ?? "module";
  const language = languageOf(filePath, options.ecmaFeatures?.jsx === true);
  // ESLint already turns `#!` into `//`; a caller that parses on its own gets the same.
  const source = code.startsWith("#!") ? `//${code.slice(2)}` : code;
  const lines = new LineIndex(source);
  // Refused before the native parser, which would overflow its stack and end the process.
  const bracket = bracketOverflow(source);
  if (bracket !== -1) fail(TOO_DEEP, bracket, lines);
  const result = deps.parseSync(filePath, source, {
    lang: language,
    sourceType,
    astType: "ts",
    range: true,
    preserveParens: false,
  });
  const failure = result.errors.find((error) => error.severity === "Error");
  if (failure !== undefined) fail(failure.message, failure.labels[0]?.start ?? 0, lines);

  const program = result.program as RawNode;
  // Refused before the scope analysis and ESLint's traversal, which recurse once per level.
  const deep = deepNode(program, deps.visitorKeys);
  if (deep !== null) fail(TOO_DEEP, startOf(deep), lines);
  // `hashbang` is a non-standard field of oxc's `Program`.
  delete program["hashbang"];
  attachLocations(program, lines);
  program["tokens"] = tokenize(source, program, result.comments, lines);
  program["comments"] = result.comments.map((comment) => ({
    type: comment.type,
    value: comment.value,
    range: [comment.start, comment.end],
    loc: lines.location(comment.start, comment.end),
  }));
  const scopeManager = deps.analyze(program, {
    childVisitorKeys: deps.visitorKeys,
    globalReturn: sourceType === "commonjs",
    impliedStrict: false,
    // ShadowJS compiles JSX itself: there is no `React` in scope to reference.
    jsxPragma: null,
    jsxFragmentName: null,
    lib: ["esnext"],
    sourceType: sourceType === "script" || sourceType === "commonjs" ? "script" : "module",
  });
  return { ast: program, services: { program: null }, scopeManager, visitorKeys: deps.visitorKeys };
}

/**
 * An ESLint parser for JavaScript, JSX, TypeScript and TSX that does not use the TypeScript
 * compiler API, so it runs on TypeScript 7 (which has none) and on any other version.
 *
 * It parses with `oxc-parser`, whose syntax tree has the shape of typescript-estree; builds the
 * tokens, comments and locations ESLint wants; and analyzes scopes with
 * `@typescript-eslint/scope-manager`, which needs no TypeScript either. No type information is
 * available: rules that can use types (`signal-must-be-called`) fall back to
 * syntax. The preset configs (`recommended`, `strict`, `migration`, `dusk`) set it; to use
 * typescript-eslint instead, put its parser after the preset (see the README).
 *
 * @example
 * // eslint.config.js
 * import { parser } from "@shadow-js/eslint-plugin/parser";
 * export default [{ files: ["**\/*.{ts,tsx}"], languageOptions: { parser } }];
 * @since 1.0.0
 */
export const parser: ShadowParser = {
  meta: { name: "@shadow-js/eslint-plugin/parser", version: __VERSION__ },
  parse(code: string, options?: ParseOptions): Record<string, unknown> {
    return parseForESLint(code, options).ast;
  },
  parseForESLint,
};

export default parser;
