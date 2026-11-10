import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import {
  events,
  groupMembers,
  groups,
  issueAssignees,
  issues,
  mergeRequestReviewers,
  mergeRequests,
  projects,
  user,
} from "@db/schema";
import type { AppEnv } from "@worker/env";
import {
  assertAuthenticated,
  confidentialProjectIds,
  viewableProjectIds,
} from "@worker/services/access";
import { ensurePersonalGroup } from "@worker/services/personal-groups";
import { unauthorized } from "@worker/lib/errors";

export const meRoutes = new Hono<AppEnv>();

function safeUser(row: typeof user.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    username: row.username,
    displayUsername: row.displayUsername,
    isAdmin: row.isAdmin,
    createdAt: row.createdAt,
  };
}

meRoutes.get("/me", async (c) => {
  const session = assertAuthenticated(c);
  const db = c.get("db");
  const [record] = await db
    .select()
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  if (!record) throw unauthorized();

  await ensurePersonalGroup(db, record);

  const memberships = await db
    .select({ group: groups, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, record.id))
    .orderBy(desc(groups.personal), groups.name);

  return c.json({
    user: safeUser(record),
    artifactsFake: c.env.ARTIFACTS_FAKE === "true",
    groups: memberships.map(({ group, role }) => ({
      id: group.id,
      slug: group.slug,
      name: group.name,
      description: group.description,
      visibility: group.visibility,
      personal: group.personal,
      archivedAt: group.archivedAt,
      role,
    })),
  });
});

meRoutes.get("/dashboard", async (c) => {
  const session = assertAuthenticated(c);
  const db = c.get("db");
  const ids = await viewableProjectIds(db, session);

  if (ids.length === 0) {
    return c.json({
      assignedIssues: [],
      reviewRequests: [],
      recentProjects: [],
      activity: [],
    });
  }

  const confidentialIds = await confidentialProjectIds(db, session);
  const assignedVisibility: SQL = confidentialIds.length
    ? or(
        eq(issues.confidential, false),
        inArray(issues.projectId, confidentialIds)
      )!
    : eq(issues.confidential, false);

  const [assignedIssues, reviewRequests, recentProjects, activity] =
    await Promise.all([
      db
        .select({
          iid: issues.iid,
          title: issues.title,
          state: issues.state,
          updatedAt: issues.updatedAt,
          projectSlug: projects.slug,
          projectName: projects.name,
          groupSlug: groups.slug,
          confidential: issues.confidential,
        })
        .from(issueAssignees)
        .innerJoin(issues, eq(issueAssignees.issueId, issues.id))
        .innerJoin(projects, eq(issues.projectId, projects.id))
        .innerJoin(groups, eq(projects.groupId, groups.id))
        .where(
          and(
            eq(issueAssignees.userId, session.user.id),
            eq(issues.state, "opened"),
            inArray(issues.projectId, ids),
            assignedVisibility
          )
        )
        .orderBy(desc(issues.updatedAt))
        .limit(12),
      db
        .select({
          iid: mergeRequests.iid,
          title: mergeRequests.title,
          state: mergeRequests.state,
          updatedAt: mergeRequests.updatedAt,
          projectSlug: projects.slug,
          projectName: projects.name,
          groupSlug: groups.slug,
        })
        .from(mergeRequestReviewers)
        .innerJoin(
          mergeRequests,
          eq(mergeRequestReviewers.mergeRequestId, mergeRequests.id)
        )
        .innerJoin(projects, eq(mergeRequests.projectId, projects.id))
        .innerJoin(groups, eq(projects.groupId, groups.id))
        .where(
          and(
            eq(mergeRequestReviewers.userId, session.user.id),
            eq(mergeRequests.state, "opened"),
            eq(mergeRequestReviewers.state, "pending"),
            inArray(mergeRequests.projectId, ids)
          )
        )
        .orderBy(desc(mergeRequests.updatedAt))
        .limit(12),
      db
        .select({
          slug: projects.slug,
          name: projects.name,
          description: projects.description,
          updatedAt: projects.updatedAt,
          groupSlug: groups.slug,
          groupName: groups.name,
        })
        .from(projects)
        .innerJoin(groups, eq(projects.groupId, groups.id))
        .where(and(inArray(projects.id, ids)))
        .orderBy(desc(projects.updatedAt))
        .limit(8),
      db
        .select({
          id: events.id,
          action: events.action,
          createdAt: events.createdAt,
          metadata: events.metadata,
          targetIid: events.targetIid,
          projectSlug: projects.slug,
          projectName: projects.name,
          groupSlug: groups.slug,
          actorName: user.name,
          actorUsername: user.username,
        })
        .from(events)
        .leftJoin(projects, eq(events.projectId, projects.id))
        .leftJoin(groups, eq(projects.groupId, groups.id))
        .leftJoin(user, eq(events.actorId, user.id))
        .where(inArray(events.projectId, ids))
        .orderBy(desc(events.createdAt))
        .limit(20),
    ]);

  return c.json({
    assignedIssues,
    reviewRequests,
    recentProjects,
    activity: activity.map((item) => {
      const metadata = item.metadata as Record<string, unknown>;
      const { title: _title, ...safeMetadata } = metadata;
      return { ...item, metadata: safeMetadata };
    }),
  });
});
