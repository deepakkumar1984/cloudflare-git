import { eq } from "drizzle-orm";
import type { Database } from "@db/client";
import { groupMembers, projectMembers, type Project } from "@db/schema";
import { badRequest } from "@worker/lib/errors";

export async function getProjectMemberIds(
  db: Database,
  project: Project
): Promise<Set<string>> {
  const [groupRows, projectRows] = await Promise.all([
    db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, project.groupId)),
    db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, project.id)),
  ]);
  return new Set([
    ...groupRows.map((row) => row.userId),
    ...projectRows.map((row) => row.userId),
  ]);
}

export async function assertAssignableUsers(
  db: Database,
  project: Project,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;
  const allowed = await getProjectMemberIds(db, project);
  const invalid = userIds.filter((id) => !allowed.has(id));
  if (invalid.length > 0) {
    throw badRequest("One or more users are not members of this project");
  }
}
