import { and, desc, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { groupMembers, groups, projects, user } from "@db/schema";
import { atLeast, canCreateProject, canManageGroup } from "@shared/permissions";
import {
  groupCreateSchema,
  groupUpdateSchema,
  memberAddSchema,
  memberUpdateSchema,
  projectCreateSchema,
} from "@shared/schemas";
import { getGitStorage } from "@worker/artifacts";
import type { AppEnv } from "@worker/env";
import {
  assertAuthenticated,
  assertGroupRole,
  assertGroupWritable,
  groupSummary,
  isAdminSession,
  loadGroup,
} from "@worker/services/access";
import { recordAudit, recordEvent } from "@worker/services/events";
import {
  revokeGroupTokens,
  revokeUserGroupTokens,
} from "@worker/services/git-tokens";
import {
  createProject,
  deleteStoredGroup,
  projectVisibilityAllowed,
} from "@worker/services/projects";
import {
  conflict,
  forbidden,
  isUniqueViolation,
  notFound,
  readJson,
  tooManyRequests,
} from "@worker/lib/errors";
import { consumeRateLimit } from "@worker/lib/rate-limit";

export const groupRoutes = new Hono<AppEnv>();

function memberUser(row: typeof user.$inferSelect, includeEmail: boolean) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    displayUsername: row.displayUsername,
    email: includeEmail ? row.email : null,
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

groupRoutes.get("/groups", async (c) => {
  const session = assertAuthenticated(c);
  const db = c.get("db");

  const rows = await db
    .select({ group: groups, role: groupMembers.role })
    .from(groups)
    .leftJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groups.id),
        eq(groupMembers.userId, session.user.id)
      )
    )
    .where(
      isAdminSession(session)
        ? sql`true`
        : or(
            eq(groupMembers.userId, session.user.id),
            eq(groups.visibility, "internal")
          )
    )
    .orderBy(desc(groups.personal), groups.name);

  return c.json({
    groups: rows.map(({ group, role }) => groupSummary(group, role ?? null)),
  });
});

groupRoutes.post("/groups", async (c) => {
  const session = assertAuthenticated(c);
  const db = c.get("db");
  const input = await readJson(c, groupCreateSchema);

  const groupId = crypto.randomUUID();
  try {
    const [createdRows] = await db.batch([
      db
        .insert(groups)
        .values({
          id: groupId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          personal: false,
          createdBy: session.user.id,
        })
        .returning(),
      db.insert(groupMembers).values({
        groupId,
        userId: session.user.id,
        role: "owner",
      }),
    ]);
    const group = createdRows[0];
    if (!group) throw new Error("Could not create group");

    await recordEvent(db, {
      groupId: group.id,
      actorId: session.user.id,
      action: "group.created",
      targetType: "group",
      targetId: group.id,
      metadata: { name: group.name },
    });

    return c.json({ group: groupSummary(group, "owner") }, 201);
  } catch (error) {
    if (isUniqueViolation(error, "groups.slug")) {
      throw conflict("That group path is already taken");
    }
    throw error;
  }
});

groupRoutes.get("/groups/:groupSlug", loadGroup, async (c) => {
  const group = c.get("group");
  const role = c.get("groupRole");
  const db = c.get("db");

  let visibleProjects: Array<typeof projects.$inferSelect> = [];
  if (role || group.visibility === "internal") {
    visibleProjects = await db
      .select()
      .from(projects)
      .where(
        role
          ? eq(projects.groupId, group.id)
          : and(
              eq(projects.groupId, group.id),
              eq(projects.visibility, "internal")
            )
      )
      .orderBy(desc(projects.updatedAt));
  }

  return c.json({
    group: {
      ...groupSummary(group, role),
      canManage: canManageGroup(role),
      canCreateProject: canCreateProject(role),
    },
    projects: visibleProjects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      visibility: project.visibility,
      defaultBranch: project.defaultBranch,
      provisioningState: project.provisioningState,
      archivedAt: project.archivedAt,
      updatedAt: project.updatedAt,
      role,
    })),
  });
});

groupRoutes.patch("/groups/:groupSlug", loadGroup, async (c) => {
  const session = assertAuthenticated(c);
  const group = c.get("group");
  const db = c.get("db");
  const input = await readJson(c, groupUpdateSchema);
  assertGroupRole(c, "owner");
  assertGroupWritable(c);

  if (group.personal && input.visibility && input.visibility !== "private") {
    throw conflict("Personal groups are always private");
  }

  if (input.visibility === "private") {
    const [internalProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.groupId, group.id), eq(projects.visibility, "internal"))
      )
      .limit(1);
    if (internalProject) {
      throw conflict(
        "Make all internal projects private before making the group private"
      );
    }
  }

  const [updated] = await db
    .update(groups)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.visibility === undefined
        ? {}
        : { visibility: input.visibility }),
      updatedAt: new Date(),
    })
    .where(eq(groups.id, group.id))
    .returning();
  if (!updated) throw notFound("Group not found");

  await recordEvent(db, {
    groupId: group.id,
    actorId: session.user.id,
    action: "group.updated",
    targetType: "group",
    targetId: group.id,
    metadata: { fields: Object.keys(input) },
  });

  return c.json({ group: groupSummary(updated, c.get("groupRole")) });
});

groupRoutes.post("/groups/:groupSlug/archive", loadGroup, async (c) => {
  const session = assertAuthenticated(c);
  const group = c.get("group");
  assertGroupRole(c, "owner");
  if (group.personal) throw conflict("Personal groups cannot be archived");
  if (group.archivedAt) return c.json({ ok: true });

  const db = c.get("db");
  const [updated] = await db
    .update(groups)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(groups.id, group.id))
    .returning();
  await revokeGroupTokens(db, getGitStorage(c.env), group.id);
  await recordEvent(db, {
    groupId: group.id,
    actorId: session.user.id,
    action: "group.archived",
    targetType: "group",
    targetId: group.id,
  });
  return c.json({ group: groupSummary(updated ?? group, c.get("groupRole")) });
});

groupRoutes.delete("/groups/:groupSlug", loadGroup, async (c) => {
  const session = assertAuthenticated(c);
  const group = c.get("group");
  assertGroupRole(c, "owner");
  if (group.personal) throw conflict("Personal groups cannot be deleted");
  const db = c.get("db");
  const detail = { slug: group.slug, name: group.name };
  await deleteStoredGroup(db, getGitStorage(c.env), group.id);
  await recordAudit(db, {
    actorId: session.user.id,
    action: "group.deleted",
    detail,
    ipAddress: c.req.header("cf-connecting-ip"),
  });
  return c.body(null, 204);
});

groupRoutes.post("/groups/:groupSlug/unarchive", loadGroup, async (c) => {
  const session = assertAuthenticated(c);
  const group = c.get("group");
  assertGroupRole(c, "owner");
  if (!group.archivedAt) return c.json({ ok: true });
  const db = c.get("db");
  const [updated] = await db
    .update(groups)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(groups.id, group.id))
    .returning();
  await recordEvent(db, {
    groupId: group.id,
    actorId: session.user.id,
    action: "group.updated",
    targetType: "group",
    targetId: group.id,
    metadata: { unarchived: true },
  });
  return c.json({ group: groupSummary(updated ?? group, c.get("groupRole")) });
});

groupRoutes.get("/groups/:groupSlug/members", loadGroup, async (c) => {
  const group = c.get("group");
  const role = c.get("groupRole");
  if (!role) throw forbidden("Group members are visible to members only");
  const db = c.get("db");
  const rows = await db
    .select({ member: groupMembers, person: user })
    .from(groupMembers)
    .innerJoin(user, eq(groupMembers.userId, user.id))
    .where(eq(groupMembers.groupId, group.id))
    .orderBy(groupMembers.createdAt);

  const includeEmail = canManageGroup(role);
  return c.json({
    members: rows.map(({ member, person }) => ({
      role: member.role,
      createdAt: member.createdAt,
      user: memberUser(person, includeEmail),
    })),
    canManage: includeEmail,
  });
});

groupRoutes.post("/groups/:groupSlug/members", loadGroup, async (c) => {
  const session = assertAuthenticated(c);
  const group = c.get("group");
  assertGroupRole(c, "owner");
  assertGroupWritable(c);
  if (group.personal)
    throw conflict("Personal groups cannot have extra members");
  const db = c.get("db");
  const input = await readJson(c, memberAddSchema);
  const lookup = await consumeRateLimit(
    db,
    `member-lookup:${session.user.id}`,
    30,
    60_000
  );
  if (!lookup.allowed) {
    throw tooManyRequests(
      "Too many member lookups. Wait a minute and try again.",
      lookup.retryAfterSeconds
    );
  }
  const target = await findUserByIdentifier(db, input.identifier);
  if (!target) throw notFound("No user found with that username or email");

  try {
    const [member] = await db
      .insert(groupMembers)
      .values({
        groupId: group.id,
        userId: target.id,
        role: input.role,
      })
      .returning();
    await recordEvent(db, {
      groupId: group.id,
      actorId: session.user.id,
      action: "group.member_added",
      targetType: "user",
      targetId: target.id,
      metadata: { role: input.role, username: target.username },
    });
    await recordAudit(db, {
      actorId: session.user.id,
      groupId: group.id,
      action: "group.member_added",
      detail: { userId: target.id, role: input.role },
      ipAddress: c.req.header("cf-connecting-ip"),
    });
    return c.json(
      {
        member: {
          role: member?.role ?? input.role,
          user: memberUser(target, true),
        },
      },
      201
    );
  } catch (error) {
    if (
      isUniqueViolation(error, "group_members.group_id, group_members.user_id")
    ) {
      throw conflict("That user is already a member");
    }
    throw error;
  }
});

/**
 * Keeps the write itself from removing the last owner. Two overlapping
 * requests serialize on D1, so the second sees the first commit and stops.
 */
function keepsAnOwner(groupId: string, removingOwner: boolean) {
  if (!removingOwner) return undefined;
  return sql`(
    ${groupMembers.role} != 'owner'
    or (
      select count(*) from group_members
      where group_id = ${groupId} and role = 'owner'
    ) > 1
  )`;
}

groupRoutes.patch(
  "/groups/:groupSlug/members/:userId",
  loadGroup,
  async (c) => {
    const session = assertAuthenticated(c);
    const group = c.get("group");
    assertGroupRole(c, "owner");
    assertGroupWritable(c);
    if (group.personal)
      throw conflict("Personal groups cannot have extra members");
    const targetUserId = c.req.param("userId");
    if (!targetUserId) throw notFound("Member not found");
    const db = c.get("db");
    const input = await readJson(c, memberUpdateSchema);

    const [target] = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, group.id),
          eq(groupMembers.userId, targetUserId)
        )
      )
      .limit(1);
    if (!target) throw notFound("Member not found");

    const [updated] = await db
      .update(groupMembers)
      .set({ role: input.role })
      .where(
        and(
          eq(groupMembers.groupId, group.id),
          eq(groupMembers.userId, targetUserId),
          keepsAnOwner(group.id, input.role !== "owner")
        )
      )
      .returning();
    if (!updated) throw conflict("A group must have at least one owner");

    const storage = getGitStorage(c.env);
    await revokeUserGroupTokens(db, storage, group.id, targetUserId);
    await recordEvent(db, {
      groupId: group.id,
      actorId: session.user.id,
      action: "group.member_updated",
      targetType: "user",
      targetId: targetUserId,
      metadata: {
        roleChangedTo: input.role,
        previousRole: target.role,
      },
    });

    return c.json({
      member: { role: updated?.role ?? input.role, userId: targetUserId },
    });
  }
);

groupRoutes.delete(
  "/groups/:groupSlug/members/:userId",
  loadGroup,
  async (c) => {
    const session = assertAuthenticated(c);
    const group = c.get("group");
    assertGroupRole(c, "owner");
    assertGroupWritable(c);
    if (group.personal)
      throw conflict("Personal groups cannot have extra members");
    const targetUserId = c.req.param("userId");
    if (!targetUserId) throw notFound("Member not found");
    const db = c.get("db");

    const deleted = await db
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, group.id),
          eq(groupMembers.userId, targetUserId),
          keepsAnOwner(group.id, true)
        )
      )
      .returning({ userId: groupMembers.userId });
    if (deleted.length === 0) {
      const [stillThere] = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, group.id),
            eq(groupMembers.userId, targetUserId)
          )
        )
        .limit(1);
      if (stillThere) throw conflict("A group must have at least one owner");
      throw notFound("Member not found");
    }

    const storage = getGitStorage(c.env);
    await revokeUserGroupTokens(db, storage, group.id, targetUserId);
    await recordEvent(db, {
      groupId: group.id,
      actorId: session.user.id,
      action: "group.member_removed",
      targetType: "user",
      targetId: targetUserId,
    });
    await recordAudit(db, {
      actorId: session.user.id,
      groupId: group.id,
      action: "group.member_removed",
      detail: { userId: targetUserId },
      ipAddress: c.req.header("cf-connecting-ip"),
    });
    return c.body(null, 204);
  }
);

groupRoutes.post("/groups/:groupSlug/projects", loadGroup, async (c) => {
  const session = assertAuthenticated(c);
  const group = c.get("group");
  const role = c.get("groupRole");
  if (!canCreateProject(role)) throw forbidden();
  assertGroupWritable(c);
  const input = await readJson(c, projectCreateSchema);
  if (!projectVisibilityAllowed(group, input.visibility)) {
    throw conflict(
      "Project visibility cannot be broader than its group visibility"
    );
  }

  const db = c.get("db");
  const storage = getGitStorage(c.env);
  let project: Awaited<ReturnType<typeof createProject>>;
  try {
    project = await createProject(
      db,
      storage,
      c.env,
      { id: session.user.id },
      {
        groupId: group.id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        defaultBranch: input.defaultBranch,
      }
    );
  } catch (error) {
    if (isUniqueViolation(error, "projects.group_id, projects.slug")) {
      throw conflict("That project path is already taken");
    }
    throw error;
  }

  return c.json(
    {
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        description: project.description,
        visibility: project.visibility,
        defaultBranch: project.defaultBranch,
        provisioningState: project.provisioningState,
        provisioningError: project.provisioningError,
        role: atLeast(role, "owner") ? "owner" : "maintainer",
      },
    },
    201
  );
});
