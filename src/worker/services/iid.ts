import { eq, sql } from "drizzle-orm";
import type { Database } from "@db/client";
import { projectCounters } from "@db/schema";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Issues and merge requests share one per-project IID sequence, like GitLab's
 * project-level references. The UPDATE ... RETURNING row lock serializes
 * concurrent allocations.
 */
export async function allocateIid(
  tx: Tx | Database,
  projectId: string
): Promise<number> {
  const [row] = await tx
    .update(projectCounters)
    .set({ nextIid: sql`${projectCounters.nextIid} + 1` })
    .where(eq(projectCounters.projectId, projectId))
    .returning({ value: projectCounters.nextIid });
  if (!row) throw new Error("Project IID counter is missing");
  return row.value - 1;
}
