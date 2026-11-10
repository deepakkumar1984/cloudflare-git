import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Database } from "@db/client";
import { mergeRequests, projects } from "@db/schema";
import type { GitStorage } from "@worker/artifacts";
import { refreshRepositoryRefs } from "./repository";

export async function reconcileStaleProjects(
  db: Database,
  storage: GitStorage
): Promise<void> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1_000);
  const stale = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.provisioningState, "ready"),
        isNull(projects.archivedAt),
        or(isNull(projects.lastSyncedAt), lt(projects.lastSyncedAt, cutoff))
      )
    )
    .orderBy(desc(projects.updatedAt))
    .limit(10);

  const openMrProjects = await db
    .selectDistinct({ projectId: mergeRequests.projectId })
    .from(mergeRequests)
    .where(eq(mergeRequests.state, "opened"))
    .limit(10);

  const byId = new Map(stale.map((project) => [project.id, project]));
  if (openMrProjects.length > 0) {
    const openIds = new Set(openMrProjects.map((row) => row.projectId));
    const extra = await db
      .select()
      .from(projects)
      .where(
        and(
          inArray(projects.id, [...openIds]),
          eq(projects.provisioningState, "ready"),
          isNull(projects.archivedAt),
          or(
            isNull(projects.lastSyncedAt),
            lt(projects.lastSyncedAt, new Date(Date.now() - 2 * 60 * 1_000))
          )
        )
      )
      .limit(10);
    for (const project of extra) {
      if (openIds.has(project.id)) byId.set(project.id, project);
    }
  }

  for (const project of byId.values()) {
    try {
      await refreshRepositoryRefs(db, storage, project);
    } catch (error) {
      console.warn("repository_reconcile_failed", {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
