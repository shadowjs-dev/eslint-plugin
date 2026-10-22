/**
 * Levenshtein edit distance between two strings (single-character inserts, deletes and
 * substitutions), with an early exit once the distance is known to exceed `limit`.
 *
 * The exit makes the cost proportional to the strings that are close, which is all a "did you
 * mean" hint needs: past the limit the exact distance is never used.
 *
 * @param a The first string.
 * @param b The second string.
 * @param limit The largest distance the caller cares about (default `3`).
 * @returns The exact distance when it is at most `limit`; otherwise a number greater than `limit`
 * that is not necessarily the exact distance.
 * @example
 * import { editDistance } from "@shadow-js/eslint-plugin/utils/text";
 *
 * const near: number = editDistance("onClik", "onClick"); // 1
 * const far: number = editDistance("onMouseEnter", "onBlur", 2); // greater than 2
 * @since 1.0.0
 * @see {@link closest}
 */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
}

/**
 * The candidate closest to `word` by {@link editDistance}, used for "did you mean" hints.
 *
 * @param word The word as written (a misspelled event or attribute name, for example).
 * @param candidates The known spellings, searched in iteration order.
 * @param limit The largest distance that still counts as a match (default `2`).
 * @returns The candidate with the smallest distance at most `limit` (on a tie, the first one in
 * iteration order), or `undefined` when no candidate is that close.
 * @example
 * import { closest } from "@shadow-js/eslint-plugin/utils/text";
 *
 * const hint: string | undefined = closest("onClik", ["onClick", "onClose"]); // "onClick"
 * const none: string | undefined = closest("onWhatever", ["onClick"]); // undefined
 * @since 1.0.0
 * @see {@link editDistance}
 */
export function closest(word: string, candidates: Iterable<string>, limit = 2): string | undefined {
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    const distance = editDistance(word, candidate, limit);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
