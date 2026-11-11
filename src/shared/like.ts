/** D1 rejects LIKE and GLOB patterns longer than 50 UTF-8 bytes. */
export const LIKE_PATTERN_MAX_BYTES = 50;

/** Escape LIKE metacharacters so user text is matched literally. */
export function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

/** A trailing odd backslash would escape the closing `%` of the pattern. */
function stripDanglingEscape(value: string): string {
  let slashes = 0;
  for (
    let index = value.length - 1;
    index >= 0 && value[index] === "\\";
    index -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1 ? value.slice(0, -1) : value;
}

/**
 * Builds a contains-pattern that fits D1's limit.
 * `%`, `_`, and `\` in the input are escaped. SQLite LIKE is
 * case-insensitive for ASCII only. Callers must pass `ESCAPE '\'`.
 */
export function likeContains(value: string): string {
  const escaped = escapeLike(value);
  const budget = LIKE_PATTERN_MAX_BYTES - 2;
  const encoder = new TextEncoder();
  let kept = "";
  let bytes = 0;
  for (const char of escaped) {
    const size = encoder.encode(char).length;
    if (bytes + size > budget) break;
    kept += char;
    bytes += size;
  }
  return `%${stripDanglingEscape(kept)}%`;
}
