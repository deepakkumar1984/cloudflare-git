import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeRateLimit } from "@worker/lib/rate-limit";

afterEach(() => {
  vi.useRealTimers();
});

describe("rate limiter", () => {
  it("blocks after the limit and recovers after the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const key = `test-${crypto.randomUUID()}`;

    expect(consumeRateLimit(key, 2, 60_000).allowed).toBe(true);
    expect(consumeRateLimit(key, 2, 60_000).allowed).toBe(true);
    const blocked = consumeRateLimit(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);

    vi.advanceTimersByTime(60_001);
    expect(consumeRateLimit(key, 2, 60_000).allowed).toBe(true);
  });

  it("keeps separate buckets per key", () => {
    const first = `test-${crypto.randomUUID()}`;
    const second = `test-${crypto.randomUUID()}`;
    expect(consumeRateLimit(first, 1, 60_000).allowed).toBe(true);
    expect(consumeRateLimit(first, 1, 60_000).allowed).toBe(false);
    expect(consumeRateLimit(second, 1, 60_000).allowed).toBe(true);
  });
});
