import type { Database } from "./client";

/** D1 allows at most 100 bound parameters in one SQL statement. */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * A commit upsert binds the 11 inserted values plus the `created_at` default.
 * Eight rows stay under D1's 100-parameter cap (12 * 8 = 96).
 */
export const COMMIT_UPSERT_BATCH_ROWS = 8;

export function chunkRows<T>(items: readonly T[], maxRows: number): T[][] {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("maxRows must be a positive integer");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += maxRows) {
    chunks.push(items.slice(index, index + maxRows));
  }
  return chunks;
}

type BatchStatement = Parameters<Database["batch"]>[0][number];

/**
 * Runs statements as one atomic D1 batch. D1 has no interactive transactions,
 * so every statement must be built before this call.
 */
export async function writeBatch(
  db: Database,
  statements: readonly BatchStatement[]
): Promise<readonly unknown[]> {
  if (statements.length === 0) return [];
  return db.batch(statements as unknown as Parameters<Database["batch"]>[0]);
}
