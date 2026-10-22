import type { LineIndex, SourceLocation } from "./locations";

/** A node as the parser walks it: any object with a string `type`. */
export type RawNode = { [key: string]: unknown };

/** An ESLint token. */
export interface Token {
  type: string;
  value: string;
  range: [number, number];
  loc: SourceLocation;
}

/** A comment as `oxc-parser` reports it. */
export interface RawComment {
  readonly start: number;
  readonly end: number;
}

/** Words that are keywords wherever the grammar does not use them as a name. */
const KEYWORDS: ReadonlySet<string> = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  // Reserved in strict mode, so keywords in modules.
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
]);

const PUNCTUATORS: ReadonlySet<string> = new Set([
  ">>>=",
  "...",
  "===",
  "!==",
  "**=",
  "<<=",
  ">>=",
  ">>>",
  "&&=",
  "||=",
  "??=",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "**",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ";",
  ",",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
  "!",
  "~",
  "?",
  ":",
  "=",
  ".",
  "@",
  "#",
]);

/** The token type of a word the tree has no literal node for (`null` in a type, a keyword). */
function wordType(text: string, isName: boolean): string {
  if (isName) return "Identifier";
  if (text === "null") return "Null";
  if (text === "true" || text === "false") return "Boolean";
  return KEYWORDS.has(text) ? "Keyword" : "Identifier";
}

// ZWNJ and ZWJ may continue a name; they sit outside the class so the pattern stays one character wide.
const WORD = /[\p{ID_Start}$_\\](?:[\p{ID_Continue}$\\]|\u200c|\u200d)*/uy;
const SPACE = /\s+/uy;

const BRACE = 0;
const TEMPLATE = 1;

interface Atom {
  readonly type: string;
  readonly end: number;
}

/** What the syntax tree says about the places where the text alone is ambiguous. */
interface Landmarks {
  /** Single tokens whose text cannot be split by the scanner (literals, JSX text, `#names`). */
  readonly atoms: Map<number, Atom>;
  /** Starts of template literals (the backtick that opens one). */
  readonly templates: Set<number>;
  /** Words that are `Identifier` nodes although they spell a keyword (`a.default`). */
  readonly names: Set<number>;
  /** Positions of `<` and `>` that open and close type arguments and parameters. */
  readonly angleOpen: Set<number>;
  readonly angleClose: Set<number>;
}

function nodeType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const type: unknown = Reflect.get(value, "type");
  return typeof type === "string" ? type : undefined;
}

function literalType(node: RawNode, inJsxAttribute: boolean): string {
  if (node["regex"] !== undefined) return "RegularExpression";
  const value = node["value"];
  if (typeof value === "string") return inJsxAttribute ? "JSXText" : "String";
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number" || typeof value === "bigint" || node["bigint"] !== undefined) {
    return "Numeric";
  }
  return "Null";
}

/** Walks the tree once, without recursion, and records the landmarks. */
function collect(program: RawNode): Landmarks {
  const atoms = new Map<number, Atom>();
  const templates = new Set<number>();
  const names = new Set<number>();
  const angleOpen = new Set<number>();
  const angleClose = new Set<number>();
  const attributeValues = new Set<unknown>();
  const metaNames = new Set<unknown>();
  const pending: unknown[] = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    const type = nodeType(value);
    if (type === undefined || typeof value !== "object" || value === null) continue;
    const node = value as RawNode;
    const start = node["start"];
    const end = node["end"];
    if (typeof start === "number" && typeof end === "number") {
      switch (type) {
        case "Literal":
          atoms.set(start, { type: literalType(node, attributeValues.has(node)), end });
          break;
        case "JSXText":
          atoms.set(start, { type: "JSXText", end });
          break;
        case "JSXIdentifier":
          atoms.set(start, { type: "JSXIdentifier", end });
          break;
        case "PrivateIdentifier":
          atoms.set(start, { type: "PrivateIdentifier", end });
          break;
        case "TemplateLiteral":
        case "TSTemplateLiteralType":
          templates.add(start);
          break;
        case "Identifier":
          if (!metaNames.has(node)) names.add(start);
          break;
        case "TSTypeParameterInstantiation":
        case "TSTypeParameterDeclaration":
          angleOpen.add(start);
          angleClose.add(end - 1);
          break;
        default:
          break;
      }
    }
    if (type === "JSXAttribute") attributeValues.add(node["value"]);
    if (type === "MetaProperty") metaNames.add(node["meta"]);
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      const child = node[key];
      if (typeof child === "object" && child !== null) pending.push(child);
    }
  }
  return { atoms, templates, names, angleOpen, angleClose };
}

/**
 * Builds ESLint's token list. `oxc-parser` returns no tokens, and the syntax tree alone does not
 * hold the punctuation, so the source is scanned: whitespace and comments are skipped, literals and
 * JSX text are taken whole from the tree (a `/` is a regular expression or a division only the
 * tree knows), template literals are followed through their `${ }` holes, and everything else is a
 * word or a punctuator. Type argument lists end in a single `>` even when the text reads `>>`.
 *
 * @param source The text that was parsed.
 * @param program The `Program` node (with `start`/`end` on every node).
 * @param comments Comments, so their text is skipped.
 * @param lines Offset to position table of the source.
 * @returns Tokens in source order, as typescript-eslint and espree produce them.
 */
export function tokenize(
  source: string,
  program: RawNode,
  comments: readonly RawComment[],
  lines: LineIndex,
): Token[] {
  const { atoms, templates, names, angleOpen, angleClose } = collect(program);
  const commentEnds = new Map<number, number>();
  for (const comment of comments) commentEnds.set(comment.start, comment.end);
  const tokens: Token[] = [];
  const stack: number[] = [];
  const push = (type: string, start: number, end: number): void => {
    tokens.push({
      type,
      // Like espree and typescript-eslint: the value of `#name` is `name`, its range keeps the `#`.
      value: source.slice(type === "PrivateIdentifier" ? start + 1 : start, end),
      range: [start, end],
      loc: lines.location(start, end),
    });
  };
  /** Reads a template chunk that starts at the backtick or the `}` at `from`. */
  const template = (from: number): number => {
    let index = from + 1;
    while (index < source.length) {
      const char = source.charCodeAt(index);
      if (char === 92) {
        index += 2;
      } else if (char === 96) {
        push("Template", from, index + 1);
        return index + 1;
      } else if (char === 36 && source.charCodeAt(index + 1) === 123) {
        stack.push(TEMPLATE);
        push("Template", from, index + 2);
        return index + 2;
      } else {
        index += 1;
      }
    }
    push("Template", from, source.length);
    return source.length;
  };
  const crossesLandmark = (from: number, length: number): boolean => {
    for (let offset = 1; offset < length; offset += 1) {
      if (atoms.has(from + offset) || templates.has(from + offset)) return true;
    }
    return false;
  };

  let index = 0;
  while (index < source.length) {
    const commentEnd = commentEnds.get(index);
    if (commentEnd !== undefined) {
      index = commentEnd;
      continue;
    }
    const atom = atoms.get(index);
    if (atom !== undefined) {
      push(atom.type, index, atom.end);
      index = atom.end;
      continue;
    }
    const char = source.charCodeAt(index);
    if (char === 96 && templates.has(index)) {
      index = template(index);
      continue;
    }
    if (char === 125 && stack[stack.length - 1] === TEMPLATE) {
      stack.pop();
      index = template(index);
      continue;
    }
    SPACE.lastIndex = index;
    if (SPACE.test(source)) {
      index = SPACE.lastIndex;
      continue;
    }
    WORD.lastIndex = index;
    const word = WORD.exec(source);
    if (word !== null) {
      const text = word[0];
      push(wordType(text, names.has(index)), index, index + text.length);
      index += text.length;
      continue;
    }
    let length = 1;
    if (!(char === 60 && angleOpen.has(index)) && !(char === 62 && angleClose.has(index))) {
      for (let size = Math.min(4, source.length - index); size > 1; size -= 1) {
        if (PUNCTUATORS.has(source.slice(index, index + size)) && !crossesLandmark(index, size)) {
          length = size;
          break;
        }
      }
      // `a?.5:1` is a conditional, not an optional chain.
      if (length === 2 && char === 63 && /[0-9]/.test(source.charAt(index + 2))) length = 1;
    }
    if (length === 1) {
      if (char === 123) stack.push(BRACE);
      else if (char === 125) stack.pop();
    }
    push("Punctuator", index, index + length);
    index += length;
  }
  return tokens;
}
