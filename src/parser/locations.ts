/** A position as ESLint wants it: 1-based line, 0-based column in UTF-16 units. */
export interface Position {
  line: number;
  column: number;
}

/** A start and end position. */
export interface SourceLocation {
  start: Position;
  end: Position;
}

/** The line breaks ESLint recognizes: `\r\n`, `\r`, `\n`, U+2028 and U+2029. */
const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/gu;

/**
 * Offsets where each line starts, so an offset maps to a position by binary search.
 *
 * @example
 * const lines = new LineIndex("a\nb");
 * lines.position(2); // { line: 2, column: 0 }
 */
export class LineIndex {
  readonly #starts: number[] = [0];

  constructor(source: string) {
    for (const match of source.matchAll(LINE_BREAK)) {
      this.#starts.push(match.index + match[0].length);
    }
  }

  /** The position of `offset`. */
  position(offset: number): Position {
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if ((this.#starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - (this.#starts[low] ?? 0) };
  }

  /** The location of the half-open range `[start, end)`. */
  location(start: number, end: number): SourceLocation {
    return { start: this.position(start), end: this.position(end) };
  }
}

/** Gives every node a `loc`, walking with a stack so a deep tree cannot overflow the call stack. */
export function attachLocations(program: object, lines: LineIndex): void {
  const pending: unknown[] = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    if (typeof Reflect.get(value, "type") !== "string") continue;
    const start: unknown = Reflect.get(value, "start");
    const end: unknown = Reflect.get(value, "end");
    if (typeof start === "number" && typeof end === "number") {
      Reflect.set(value, "loc", lines.location(start, end));
    }
    for (const key of Object.keys(value)) {
      if (key === "loc" || key === "range" || key === "parent") continue;
      const child: unknown = Reflect.get(value, key);
      if (typeof child === "object" && child !== null) pending.push(child);
    }
  }
}
