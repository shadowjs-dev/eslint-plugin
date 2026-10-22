import type { RawNode } from "./tokens";

/**
 * The deepest nesting the shipped parser accepts, in brackets and in tree levels. Beyond it a source
 * is a parse error. The limit is far below where the native and JavaScript stacks give out:
 * `oxc-parser` segfaults near 5,000 nested brackets (the whole lint run dies), and the scope analysis
 * overflows at about 1,700 chained calls. Real code nests a few dozen levels.
 */
export const MAX_NESTING = 1000;

/** The character codes that open and close a bracket: `( [ {` and `) ] }`. */
const OPEN = new Set([40, 91, 123]);
const CLOSE = new Set([41, 93, 125]);

/**
 * The index of the bracket where `([{` nesting first exceeds `limit`, or `-1`. It runs before the
 * native parser, so it counts every bracket, including those inside strings, comments and template
 * text. That can only make it stricter than the grammar: no nesting the grammar would allow is ever
 * let through, and a nesting in text that is not code is refused, which real code does not contain.
 *
 * @param source The source text.
 * @param limit The deepest nesting allowed.
 * @returns The index of the offending bracket, or `-1` when the nesting is within the limit.
 */
export function bracketOverflow(source: string, limit: number = MAX_NESTING): number {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (OPEN.has(code)) {
      depth += 1;
      if (depth > limit) return index;
    } else if (CLOSE.has(code) && depth > 0) {
      depth -= 1;
    }
  }
  return -1;
}

/** True for an object that is a syntax tree node (it has a string `type`). */
function isNode(value: unknown): value is RawNode {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
  );
}

/**
 * The first node of the tree that sits deeper than `limit` levels below the program, or `null`. The
 * walk uses an explicit stack, so the depth of the tree does not overflow the stack it measures.
 *
 * @param program The `Program` node.
 * @param keys The child keys of every node type (the same keys the scope analysis walks).
 * @param limit The deepest level allowed; the program is level 0.
 * @returns The node that is too deep, or `null`.
 */
export function deepNode(
  program: RawNode,
  keys: Readonly<Record<string, readonly string[]>>,
  limit: number = MAX_NESTING,
): RawNode | null {
  const stack: Array<{ node: RawNode; depth: number }> = [{ node: program, depth: 0 }];
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    if (entry.depth > limit) return entry.node;
    const type = Reflect.get(entry.node, "type");
    if (typeof type !== "string") continue;
    for (const key of keys[type] ?? []) {
      const value = Reflect.get(entry.node, key);
      const children: unknown[] = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (isNode(child)) stack.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }
  return null;
}

/**
 * The source index of a node, from its `range` (or its `start`), for an error message.
 *
 * @param node The node.
 * @returns The offset of the node's first character, or `0`.
 */
export function startOf(node: RawNode): number {
  const range = Reflect.get(node, "range");
  if (Array.isArray(range) && typeof range[0] === "number") return range[0];
  const start = Reflect.get(node, "start");
  return typeof start === "number" ? start : 0;
}
