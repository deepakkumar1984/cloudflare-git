import { sql } from "drizzle-orm";
import type { Database } from "@db/client";
import { rateLimit } from "@db/schema";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window limiter stored in D1 so the count is shared across Worker
 * isolates. The upsert is one statement, which D1 runs atomically.
 */
export async function consumeRateLimit(
  db: Database,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitDecision> {
  const now = Date.now();
  const storedKey = `app:${key}`;
  const rows = await db
    .insert(rateLimit)
    .values({
      id: crypto.randomUUID(),
      key: storedKey,
      count: 1,
      lastRequest: now,
    })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case
          when ${now} - rate_limit.last_request >= ${windowMs} then 1
          else rate_limit.count + 1
        end`,
        lastRequest: sql`case
          when ${now} - rate_limit.last_request >= ${windowMs} then ${now}
          else rate_limit.last_request
        end`,
      },
    })
    .returning({
      count: rateLimit.count,
      lastRequest: rateLimit.lastRequest,
    });
  const row = rows[0];
  if (!row || row.count <= limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((row.lastRequest + windowMs - now) / 1_000)
    ),
  };
}
