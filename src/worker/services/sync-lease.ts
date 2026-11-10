import { and, eq, lt } from "drizzle-orm";
import type { Database } from "@db/client";
import { gitSyncLeases } from "@db/schema";

export async function acquireSyncLease(
  db: Database,
  projectId: string,
  holder: string,
  ttlSeconds: number
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
  const [lease] = await db
    .insert(gitSyncLeases)
    .values({ projectId, holder, expiresAt })
    .onConflictDoUpdate({
      target: gitSyncLeases.projectId,
      set: { holder, expiresAt },
      setWhere: lt(gitSyncLeases.expiresAt, now),
    })
    .returning();
  return Boolean(lease);
}

export async function releaseSyncLease(
  db: Database,
  projectId: string,
  holder: string
): Promise<void> {
  await db
    .delete(gitSyncLeases)
    .where(
      and(
        eq(gitSyncLeases.projectId, projectId),
        eq(gitSyncLeases.holder, holder)
      )
    );
}
