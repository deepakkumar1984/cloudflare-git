import { eq, sql } from "drizzle-orm";
import type { Database } from "@db/client";
import { projectCounters } from "@db/schema";

/**
 * Issues and merge requests share one per-project IID sequence.
 * The UPDATE ... RETURNING is atomic on D1. A later insert can still fail
 * after the counter moves, which leaves a gap. Gaps are acceptable.
 */
export async function allocateIid(
  db: Database,
  projectId: string
): Promise<number> {
  const [row] = await db
    .update(projectCounters)
    .set({ nextIid: sql`${projectCounters.nextIid} + 1` })
    .where(eq(projectCounters.projectId, projectId))
    .returning({ value: projectCounters.nextIid });
  if (!row) throw new Error("Project IID counter is missing");
  return row.value - 1;
}
