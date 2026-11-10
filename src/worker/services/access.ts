import { and, eq, inArray } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import type { Database } from "@db/client";
import {
  groupMembers,
  groups,
  projectMembers,
  projects,
  type Group,
  type Project,
} from "@db/schema";
import type { Role } from "@shared/constants";
import { atLeast, canViewProject, effectiveRole } from "@shared/permissions";
import type { AppEnv } from "@worker/env";
import {
  conflict,
  forbidden,
  notFound,
  unauthorized,
} from "@worker/lib/errors";

type SessionLike = AppEnv["Variables"]["session"];

export function isAdminSession(session: SessionLike): boolean {
  return Boolean(
    session &&
    typeof session.user === "object" &&
    session.user &&
    "isAdmin" in session.user &&
    session.user.isAdmin
  );
}

export async function getGroupRole(
  db: Database,
  groupId: string,
  userId: string | undefined,
  session: SessionLike
): Promise<Role | null> {
  if (isAdminSession(session)) return "owner";
  if (!userId) return null;
  const [row] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
    )
    .limit(1);
  return row?.role ?? null;
}

export async function getProjectRole(
  db: Database,
  project: Project,
  userId: string | undefined,
  session: SessionLike,
  groupRole?: Role | null
): Promise<Role | null> {
  if (isAdminSession(session)) return "owner";
  if (!userId) return null;
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.userId, userId)
      )
    )
    .limit(1);
  const inherited =
    groupRole === undefined
      ? await getGroupRole(db, project.groupId, userId, session)
      : groupRole;
  return effectiveRole({
    projectRole: row?.role ?? null,
    groupRole: inherited,
    isAdmin: isAdminSession(session),
  });
}

export function assertAuthenticated(
  c: Context<AppEnv>
): NonNullable<SessionLike> {
  const session = c.get("session");
  if (!session) throw unauthorized();
  return session;
}

export function assertRole(c: Context<AppEnv>, minimum: Role): Role {
  const role = c.get("role");
  if (!atLeast(role, minimum)) throw forbidden();
  return role;
}

export function assertGroupRole(c: Context<AppEnv>, minimum: Role): Role {
  const role = c.get("groupRole");
  if (!atLeast(role, minimum)) throw forbidden();
  return role;
}

export function assertGroupWritable(c: Context<AppEnv>): void {
  if (c.get("group").archivedAt) throw conflict("This group is archived");
}

export function assertProjectWritable(c: Context<AppEnv>): void {
  if (c.get("group").archivedAt) throw conflict("This group is archived");
  if (c.get("project").archivedAt) throw conflict("This project is archived");
}

export const loadGroup: MiddlewareHandler<AppEnv> = async (c, next) => {
  const slug = c.req.param("groupSlug");
  if (!slug) throw notFound("Group not found");
  const db = c.get("db");
  const session = c.get("session");
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.slug, slug.toLowerCase()))
    .limit(1);
  if (!group) throw notFound("Group not found");

  const groupRole = await getGroupRole(db, group.id, session?.user.id, session);
  const visible =
    groupRole !== null || (group.visibility === "internal" && Boolean(session));
  if (!visible) throw notFound("Group not found");

  c.set("group", group);
  c.set("groupRole", groupRole);
  await next();
};

export const loadProject: MiddlewareHandler<AppEnv> = async (c, next) => {
  const groupSlug = c.req.param("groupSlug");
  const projectSlug = c.req.param("projectSlug");
  if (!groupSlug || !projectSlug) throw notFound("Project not found");

  const db = c.get("db");
  const session = c.get("session");
  const [row] = await db
    .select({ project: projects, group: groups })
    .from(projects)
    .innerJoin(groups, eq(projects.groupId, groups.id))
    .where(
      and(
        eq(groups.slug, groupSlug.toLowerCase()),
        eq(projects.slug, projectSlug.toLowerCase())
      )
    )
    .limit(1);
  if (!row) throw notFound("Project not found");

  const groupRole = await getGroupRole(
    db,
    row.group.id,
    session?.user.id,
    session
  );
  const role = await getProjectRole(
    db,
    row.project,
    session?.user.id,
    session,
    groupRole
  );
  if (!canViewProject(role, row.project.visibility, Boolean(session))) {
    throw notFound("Project not found");
  }

  c.set("project", row.project);
  c.set("group", row.group);
  c.set("groupRole", groupRole);
  c.set("role", role);
  await next();
};

/**
 * Project IDs a viewer may see. This is used by list/search/dashboard queries so
 * permission filtering stays in SQL instead of post-filtering pages of data.
 */
export async function viewableProjectIds(
  db: Database,
  session: SessionLike
): Promise<string[]> {
  if (!session) return [];
  if (isAdminSession(session)) {
    const all = await db.select({ id: projects.id }).from(projects);
    return all.map((row) => row.id);
  }
  const userId = session.user.id;
  const [direct, inherited, internal] = await Promise.all([
    db
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId)),
    db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(groupMembers, eq(projects.groupId, groupMembers.groupId))
      .where(eq(groupMembers.userId, userId)),
    db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(groups, eq(projects.groupId, groups.id))
      .where(
        and(
          eq(projects.visibility, "internal"),
          eq(groups.visibility, "internal")
        )
      ),
  ]);
  return [
    ...new Set([
      ...direct.map((row) => row.id),
      ...inherited.map((row) => row.id),
      ...internal.map((row) => row.id),
    ]),
  ];
}

/**
 * Project IDs where the viewer can see confidential issues. Mirrors the
 * reporter+ gate used by the issue list, resolved in SQL for search.
 */
export async function confidentialProjectIds(
  db: Database,
  session: SessionLike
): Promise<string[]> {
  if (!session) return [];
  if (isAdminSession(session)) {
    const all = await db.select({ id: projects.id }).from(projects);
    return all.map((row) => row.id);
  }
  const privilegedRoles: Role[] = [
    "reporter",
    "developer",
    "maintainer",
    "owner",
  ];
  const userId = session.user.id;
  const [direct, inherited] = await Promise.all([
    db
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, userId),
          inArray(projectMembers.role, privilegedRoles)
        )
      ),
    db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(groupMembers, eq(projects.groupId, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.userId, userId),
          inArray(groupMembers.role, privilegedRoles)
        )
      ),
  ]);
  return [...new Set([...direct, ...inherited].map((row) => row.id))];
}

export function groupSummary(group: Group, role: Role | null) {
  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    description: group.description,
    visibility: group.visibility,
    personal: group.personal,
    archivedAt: group.archivedAt,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    role,
  };
}

export function projectSummary(project: Project, role: Role | null) {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description,
    visibility: project.visibility,
    defaultBranch: project.defaultBranch,
    provisioningState: project.provisioningState,
    provisioningError: project.provisioningError,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastSyncedAt: project.lastSyncedAt,
    role,
    canWrite: atLeast(role, "developer"),
    canAdmin: atLeast(role, "owner"),
  };
}
