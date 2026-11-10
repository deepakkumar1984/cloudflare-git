import type { Database } from "@db/client";
import {
  groupMembers,
  groups,
  projectCounters,
  projectMembers,
  projects,
  user,
  type Group,
  type Project,
} from "@db/schema";
import type { Role } from "@shared/constants";
import type { AppEnv } from "@worker/env";

export async function createUser(
  db: Database,
  options: { name?: string; isAdmin?: boolean } = {}
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(user)
    .values({
      id: `u-${suffix}`,
      name: options.name ?? "Test User",
      email: `user-${suffix}@example.com`,
      username: `user-${suffix}`,
      displayUsername: `user-${suffix}`,
      isAdmin: options.isAdmin ?? false,
    })
    .returning();
  if (!row) throw new Error("Could not create test user");
  return row;
}

export async function createGroup(
  db: Database,
  creatorId: string,
  options: {
    name?: string;
    visibility?: "private" | "internal";
  } = {}
): Promise<Group> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(groups)
    .values({
      slug: `group-${suffix}`,
      name: options.name ?? "Test Group",
      visibility: options.visibility ?? "private",
      createdBy: creatorId,
    })
    .returning();
  if (!row) throw new Error("Could not create test group");
  return row;
}

export async function createProject(
  db: Database,
  input: {
    group: Group;
    creatorId: string;
    name?: string;
    slug?: string;
    visibility?: "private" | "internal";
    defaultBranch?: string;
  }
): Promise<Project> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [row] = await db
    .insert(projects)
    .values({
      groupId: input.group.id,
      slug: input.slug ?? `project-${suffix}`,
      name: input.name ?? "Test Project",
      visibility: input.visibility ?? "private",
      defaultBranch: input.defaultBranch ?? "main",
      artifactsNamespace: "deesha-git",
      artifactsRepoName: `p-${suffix}`,
      provisioningState: "ready",
      createdBy: input.creatorId,
    })
    .returning();
  if (!row) throw new Error("Could not create test project");
  await db.insert(projectCounters).values({ projectId: row.id });
  return row;
}

export async function addProjectMember(
  db: Database,
  projectId: string,
  userId: string,
  role: Role
) {
  await db.insert(projectMembers).values({ projectId, userId, role });
}

export async function addGroupMember(
  db: Database,
  groupId: string,
  userId: string,
  role: Role
) {
  await db.insert(groupMembers).values({ groupId, userId, role });
}

export function sessionFor(
  row: typeof user.$inferSelect
): NonNullable<AppEnv["Variables"]["session"]> {
  return {
    user: row,
    session: {
      id: "session-test",
      userId: row.id,
      token: "token-test",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    },
  } as unknown as NonNullable<AppEnv["Variables"]["session"]>;
}
