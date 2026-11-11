import { describe, expect, it } from "vitest";
import {
  chunkRows,
  COMMIT_UPSERT_BATCH_ROWS,
  D1_MAX_BOUND_PARAMETERS,
} from "@db/batch";
import { LIKE_PATTERN_MAX_BYTES, likeContains } from "@shared/like";

describe("D1 statement limits", () => {
  it("chunks rows without dropping or overlapping items", () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([], 9)).toEqual([]);
  });

  it("keeps a commit upsert under the bound-parameter cap", () => {
    const commits = Array.from({ length: 20 }, (_, index) => index);
    const chunks = chunkRows(commits, COMMIT_UPSERT_BATCH_ROWS);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length * 12).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    }
    expect(chunks.flat()).toEqual(commits);
  });

  it("truncates LIKE patterns on a character boundary at 50 bytes", () => {
    const ascii = likeContains(`${"a".repeat(48)}TAIL`);
    expect(ascii).toBe(`%${"a".repeat(48)}%`);
    expect(new TextEncoder().encode(ascii).length).toBe(LIKE_PATTERN_MAX_BYTES);

    const emoji = "😀".repeat(20);
    const pattern = likeContains(emoji);
    expect(new TextEncoder().encode(pattern).length).toBeLessThanOrEqual(
      LIKE_PATTERN_MAX_BYTES
    );
    expect(pattern.endsWith("%")).toBe(true);
    expect(pattern.includes("\uFFFD")).toBe(false);
  });

  it("escapes LIKE wildcards inside the pattern", () => {
    expect(likeContains("100%_done")).toBe("%100\\%\\_done%");
    expect(
      new TextEncoder().encode(likeContains("%".repeat(40))).length
    ).toBeLessThanOrEqual(LIKE_PATTERN_MAX_BYTES);
  });
});
