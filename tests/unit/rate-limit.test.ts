import { afterAll, describe, expect, it } from "vitest";
import { consumeRateLimit } from "@worker/lib/rate-limit";
import {
  closeTestDatabase,
  getTestDatabase,
  resetDatabase,
} from "../helpers/db";

afterAll(async () => {
  await closeTestDatabase();
});

describe("rate limiter", () => {
  it("blocks after the limit and keeps separate buckets", async () => {
    await resetDatabase();
    const { db } = await getTestDatabase();
    const key = `test-${crypto.randomUUID()}`;
    const other = `test-${crypto.randomUUID()}`;

    expect((await consumeRateLimit(db, key, 2, 60_000)).allowed).toBe(true);
    expect((await consumeRateLimit(db, key, 2, 60_000)).allowed).toBe(true);
    const blocked = await consumeRateLimit(db, key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect((await consumeRateLimit(db, other, 1, 60_000)).allowed).toBe(true);
  });
});
