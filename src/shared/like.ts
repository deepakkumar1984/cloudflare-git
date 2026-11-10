/** D1 rejects LIKE and GLOB patterns longer than 50 UTF-8 bytes. */
export const LIKE_PATTERN_MAX_BYTES = 50;

/**
 * Builds a contains-pattern that fits D1's limit.
 * `%` and `_` in the input stay wildcards, matching the previous search.
 * SQLite LIKE is case-insensitive for ASCII only.
 */
export function likeContains(value: string): string {
  const budget = LIKE_PATTERN_MAX_BYTES - 2;
  const encoder = new TextEncoder();
  let kept = "";
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > budget) break;
    kept += char;
    bytes += size;
  }
  return `%${kept}%`;
}
