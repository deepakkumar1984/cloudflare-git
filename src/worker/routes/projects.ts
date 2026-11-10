import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  events,
  gitRefs,
  groupMembers,
  issues,
  mergeRequests,
  projectMembers,
  projects,
  user,
} from "@db/schema";
import { ROLE_RANK, configuredAppName, type Role } from "@shared/constants";
import {
  canArchiveProject,
  canManageProjectMembers,
  canManageProjectSettings,
  canReadGit,
  canWriteGit,
  maxRole,
} from "@shared/permissions";
import {
  cloneCredentialsSchema,
  memberAddSchema,
  memberUpdateSchema,
  paginationSchema,
  projectUpdateSchema,
} from "@shared/schemas";
import { getGitStorage } from "@worker/artifacts";
import type { AppEnv } from "@worker/env";
import {
  assertAuthenticated,
  assertProjectWritable,
  assertRole,
  loadProject,
  projectSummary,
} from "@worker/services/access";
import { recordAudit, recordEvent } from "@worker/services/events";
import {
  mintGitCredentials,
  revokeProjectTokens,
  revokeUserProjectTokens,
} from "@worker/services/git-tokens";
import {
  publicGitRemote,
  resolveAppOrigin,
} from "@worker/services/public-remote";
import {
  projectVisibilityAllowed,
  provisionProject,
} from "@worker/services/projects";
import {
  importSummary,
  latestProjectImport,
} from "@worker/services/project-imports";
import {
  conflict,
  forbidden,
  isUniqueViolation,
  notFound,
  readJson,
  readQuery,
  tooManyRequests,
} from "@worker/lib/errors";
import { consumeRateLimit } from "@worker/lib/rate-limit";

export const projectRoutes = new Hono<AppEnv>();

function memberUser(row: typeof user.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    displayUsername: row.displayUsername,
    email: row.email,
    image: row.image,
  };
}

async function findUserByIdentifier(
  db: AppEnv["Variables"]["db"],
  identifier: string
) {
  const value = identifier.trim();
  if (value.includes("@")) {
    const [found] = await db
      .select()
      .from(user)
      .where(sql`lower(${user.email}) = ${value.toLowerCase()}`)
      .limit(1);
    return found;
  }
  const [found] = await db
    .select()
    .from(user)
    .where(eq(user.username, value.toLowerCase()))
    .limit(1);
  return found;
}

projectRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const group = c.get("group");
    const role = c.get("role");
    const db = c.get("db");

    const [[issueCount], [mrCount], [branchCount], latestImport] =
      await Promise.all([
        db
          .select({ value: count() })
          .from(issues)
          .where(
            and(eq(issues.projectId, project.id), eq(issues.state, "opened"))
          ),
        db
          .select({ value: count() })
          .from(mergeRequests)
          .where(
            and(
              eq(mergeRequests.projectId, project.id),
              eq(mergeRequests.state, "opened")
            )
          ),
        db
          .select({ value: count() })
          .from(gitRefs)
          .where(
            and(
              eq(gitRefs.projectId, project.id),
              eq(gitRefs.refType, "branch"),
              isNull(gitRefs.deletedAt)
            )
          ),
        latestProjectImport(db, project.id),
      ]);

    return c.json({
      group: {
        id: group.id,
        slug: group.slug,
        name: group.name,
        visibility: group.visibility,
        archivedAt: group.archivedAt,
      },
      project: {
        ...projectSummary(project, role),
        artifactsRemote: publicGitRemote(
          project.artifactsRemote,
          resolveAppOrigin(c.req.url, c.env.APP_URL)
        ),
        openIssues: issueCount?.value ?? 0,
        openMergeRequests: mrCount?.value ?? 0,
        branches: branchCount?.value ?? 0,
      },
      canManageSettings: canManageProjectSettings(role),
      canManageMembers: canManageProjectMembers(role),
      canArchive: canArchiveProject(role),
      canReadGit: canReadGit(role),
      canWriteGit: canWriteGit(role),
      latestImport: latestImport ? importSummary(latestImport) : null,
    });
  }
);

projectRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/activity",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const group = c.get("group");
    const query = readQuery(c, paginationSchema);
    const db = c.get("db");
    const where = eq(events.projectId, project.id);
    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: events.id,
          action: events.action,
          createdAt: events.createdAt,
          metadata: events.metadata,
          targetIid: events.targetIid,
          actorName: user.name,
          actorUsername: user.username,
        })
        .from(events)
        .leftJoin(user, eq(events.actorId, user.id))
        .where(where)
        .orderBy(desc(events.createdAt))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage),
      db.select({ value: count() }).from(events).where(where),
    ]);

    return c.json({
      activity: rows.map((row) => {
        const metadata = row.metadata as Record<string, unknown>;
        const { title: _title, ...safeMetadata } = metadata;
        return {
          ...row,
          metadata: safeMetadata,
          projectSlug: project.slug,
          projectName: project.name,
          groupSlug: group.slug,
        };
      }),
      total: totalRow?.value ?? 0,
      page: query.page,
      perPage: query.perPage,
    });
  }
);

projectRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    const group = c.get("group");
    const role = assertRole(c, "maintainer");
    assertProjectWritable(c);
    const input = await readJson(c, projectUpdateSchema);

    if (
      input.visibility &&
      !projectVisibilityAllowed(group, input.visibility)
    ) {
      throw conflict(
        "Project visibility cannot be broader than its group visibility"
      );
    }

    if (input.defaultBranch && input.defaultBranch !== project.defaultBranch) {
      const [branch] = await c
        .get("db")
        .select({ id: gitRefs.id })
        .from(gitRefs)
        .where(
          and(
            eq(gitRefs.projectId, project.id),
            eq(gitRefs.refName, `refs/heads/${input.defaultBranch}`),
            isNull(gitRefs.deletedAt)
          )
        )
        .limit(1);
      if (!branch) throw conflict("Default branch does not exist");
    }

    const db = c.get("db");
    const [updated] = await db
      .update(projects)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.visibility === undefined
          ? {}
          : { visibility: input.visibility }),
        ...(input.defaultBranch === undefined
          ? {}
          : { defaultBranch: input.defaultBranch }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id))
      .returning();
    if (!updated) throw notFound("Project not found");

    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "project.updated",
      targetType: "project",
      targetId: project.id,
      metadata: { fields: Object.keys(input) },
    });
    await recordAudit(db, {
      actorId: session.user.id,
      projectId: project.id,
      action: "project.updated",
      detail: { fields: Object.keys(input) },
      ipAddress: c.req.header("cf-connecting-ip"),
    });

    return c.json({ project: projectSummary(updated, role) });
  }
);

projectRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/archive",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    assertRole(c, "owner");
    if (project.archivedAt) return c.json({ ok: true });
    const db = c.get("db");
    const [updated] = await db
      .update(projects)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning();
    await revokeProjectTokens(db, getGitStorage(c.env), project);
    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "project.archived",
      targetType: "project",
      targetId: project.id,
    });
    return c.json({
      project: projectSummary(updated ?? project, c.get("role")),
    });
  }
);

projectRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/unarchive",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    assertRole(c, "owner");
    if (c.get("group").archivedAt) {
      throw conflict("Unarchive the group first");
    }
    if (!project.archivedAt) return c.json({ ok: true });
    const db = c.get("db");
    const [updated] = await db
      .update(projects)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning();
    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "project.updated",
      targetType: "project",
      targetId: project.id,
      metadata: { unarchived: true },
    });
    return c.json({
      project: projectSummary(updated ?? project, c.get("role")),
    });
  }
);

projectRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/provision",
  loadProject,
  async (c) => {
    const project = c.get("project");
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    if (project.provisioningState === "ready") {
      return c.json({ project: projectSummary(project, c.get("role")) });
    }
    const storage = getGitStorage(c.env);
    const updated = await provisionProject(
      c.get("db"),
      storage,
      project,
      configuredAppName(c.env.APP_NAME)
    );
    return c.json({ project: projectSummary(updated, c.get("role")) });
  }
);

projectRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/clone_credentials",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    const role = c.get("role");
    const input = await readJson(c, cloneCredentialsSchema);
    if (input.scope === "read") {
      if (!canReadGit(role)) throw forbidden();
    } else {
      if (!canWriteGit(role)) throw forbidden();
      if (project.archivedAt || c.get("group").archivedAt) {
        throw conflict("Archived repositories are read-only");
      }
    }

    const rate = consumeRateLimit(
      `clone-credentials:${session.user.id}:${project.id}`,
      10,
      60_000
    );
    if (!rate.allowed) {
      throw tooManyRequests(
        "Too many credentials requested. Wait a minute and try again.",
        rate.retryAfterSeconds
      );
    }

    const storage = getGitStorage(c.env);
    const credentials = await mintGitCredentials(
      c.get("db"),
      storage,
      project,
      session.user.id,
      input.scope,
      c.req.header("cf-connecting-ip")
    );
    c.header("Cache-Control", "no-store");
    return c.json({
      ...credentials,
      remote: publicGitRemote(
        credentials.remote,
        resolveAppOrigin(c.req.url, c.env.APP_URL)
      ),
    });
  }
);

projectRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/members",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const role = c.get("role");
    if (!role) throw forbidden("Project members are visible to members only");
    const db = c.get("db");

    const [groupRows, directRows] = await Promise.all([
      db
        .select({ member: groupMembers, person: user })
        .from(groupMembers)
        .innerJoin(user, eq(groupMembers.userId, user.id))
        .where(eq(groupMembers.groupId, project.groupId)),
      db
        .select({ member: projectMembers, person: user })
        .from(projectMembers)
        .innerJoin(user, eq(projectMembers.userId, user.id))
        .where(eq(projectMembers.projectId, project.id)),
    ]);

    const merged = new Map<
      string,
      {
        user: ReturnType<typeof memberUser>;
        role: Role;
        source: "group" | "project" | "both";
        createdAt: Date;
      }
    >();
    for (const { member, person } of groupRows) {
      merged.set(person.id, {
        user: memberUser(person),
        role: member.role,
        source: "group",
        createdAt: member.createdAt,
      });
    }
    for (const { member, person } of directRows) {
      const current = merged.get(person.id);
      merged.set(person.id, {
        user: memberUser(person),
        role: maxRole(current?.role, member.role) ?? member.role,
        source: current ? "both" : "project",
        createdAt: current?.createdAt ?? member.createdAt,
      });
    }

    const members = [...merged.values()].sort(
      (a, b) =>
        ROLE_RANK[b.role] - ROLE_RANK[a.role] ||
        (a.user.name || "").localeCompare(b.user.name || "")
    );

    return c.json({
      members,
      canManage: canManageProjectMembers(role),
    });
  }
);

projectRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/members",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    assertRole(c, "owner");
    assertProjectWritable(c);
    const db = c.get("db");
    const input = await readJson(c, memberAddSchema);
    const target = await findUserByIdentifier(db, input.identifier);
    if (!target) throw notFound("No user found with that username or email");

    try {
      const [member] = await db
        .insert(projectMembers)
        .values({
          projectId: project.id,
          userId: target.id,
          role: input.role,
        })
        .returning();
      await recordEvent(db, {
        projectId: project.id,
        groupId: project.groupId,
        actorId: session.user.id,
        action: "project.member_added",
        targetType: "user",
        targetId: target.id,
        metadata: { role: input.role, username: target.username },
      });
      await recordAudit(db, {
        actorId: session.user.id,
        projectId: project.id,
        action: "project.member_added",
        detail: { userId: target.id, role: input.role },
        ipAddress: c.req.header("cf-connecting-ip"),
      });
      return c.json(
        {
          member: {
            role: member?.role ?? input.role,
            user: memberUser(target),
          },
        },
        201
      );
    } catch (error) {
      if (
        isUniqueViolation(
          error,
          "project_members.project_id, project_members.user_id"
        )
      ) {
        throw conflict("That user is already a direct member");
      }
      throw error;
    }
  }
);

projectRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug/members/:userId",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    assertRole(c, "owner");
    assertProjectWritable(c);
    const targetUserId = c.req.param("userId");
    if (!targetUserId) throw notFound("Member not found");
    const input = await readJson(c, memberUpdateSchema);
    const db = c.get("db");

    const [updated] = await db
      .update(projectMembers)
      .set({ role: input.role })
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, targetUserId)
        )
      )
      .returning();
    if (!updated) throw notFound("Direct member not found");

    const storage = getGitStorage(c.env);
    await revokeUserProjectTokens(db, storage, project, targetUserId);
    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "project.member_updated",
      targetType: "user",
      targetId: targetUserId,
      metadata: { role: input.role },
    });
    return c.json({ member: { role: updated.role, userId: targetUserId } });
  }
);

projectRoutes.delete(
  "/groups/:groupSlug/projects/:projectSlug/members/:userId",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    assertRole(c, "owner");
    assertProjectWritable(c);
    const targetUserId = c.req.param("userId");
    if (!targetUserId) throw notFound("Member not found");
    const db = c.get("db");

    const deleted = await db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.userId, targetUserId)
        )
      )
      .returning({ userId: projectMembers.userId });
    if (deleted.length === 0) throw notFound("Direct member not found");

    const storage = getGitStorage(c.env);
    await revokeUserProjectTokens(db, storage, project, targetUserId);
    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "project.member_removed",
      targetType: "user",
      targetId: targetUserId,
    });
    await recordAudit(db, {
      actorId: session.user.id,
      projectId: project.id,
      action: "project.member_removed",
      detail: { userId: targetUserId },
      ipAddress: c.req.header("cf-connecting-ip"),
    });
    return c.body(null, 204);
  }
);
