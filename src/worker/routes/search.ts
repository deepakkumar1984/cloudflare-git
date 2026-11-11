import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { groups, issues, mergeRequests, projects } from "@db/schema";
import { likeContains } from "@shared/like";
import { searchSchema } from "@shared/schemas";
import type { AppEnv } from "@worker/env";
import {
  assertAuthenticated,
  confidentialProjectIds,
  viewableProjectIds,
} from "@worker/services/access";
import { readQuery } from "@worker/lib/errors";

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.get("/search", async (c) => {
  const session = assertAuthenticated(c);
  const input = readQuery(c, searchSchema);
  const db = c.get("db");
  const ids = await viewableProjectIds(db, session);
  if (ids.length === 0) {
    return c.json({
      projects: [],
      issues: [],
      mergeRequests: [],
      query: input.q,
    });
  }

  const confidentialIds = await confidentialProjectIds(db, session);
  const pattern = likeContains(input.q);
  const issueVisibility: SQL = confidentialIds.length
    ? or(
        eq(issues.confidential, false),
        inArray(issues.projectId, confidentialIds)
      )!
    : eq(issues.confidential, false);

  const [projectRows, issueRows, mergeRequestRows] = await Promise.all([
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
      .where(
        and(
          inArray(projects.id, ids),
          or(
            sql`${projects.name} LIKE ${pattern} ESCAPE '\\'`,
            sql`${projects.slug} LIKE ${pattern} ESCAPE '\\'`,
            sql`${projects.description} LIKE ${pattern} ESCAPE '\\'`
          )
        )
      )
      .orderBy(desc(projects.updatedAt))
      .limit(input.limit),
    db
      .select({
        iid: issues.iid,
        title: issues.title,
        state: issues.state,
        updatedAt: issues.updatedAt,
        confidential: issues.confidential,
        projectSlug: projects.slug,
        projectName: projects.name,
        groupSlug: groups.slug,
        groupName: groups.name,
      })
      .from(issues)
      .innerJoin(projects, eq(issues.projectId, projects.id))
      .innerJoin(groups, eq(projects.groupId, groups.id))
      .where(
        and(
          inArray(issues.projectId, ids),
          issueVisibility,
          or(
            sql`${issues.title} LIKE ${pattern} ESCAPE '\\'`,
            sql`${issues.description} LIKE ${pattern} ESCAPE '\\'`
          )
        )
      )
      .orderBy(desc(issues.updatedAt))
      .limit(input.limit),
    db
      .select({
        iid: mergeRequests.iid,
        title: mergeRequests.title,
        state: mergeRequests.state,
        updatedAt: mergeRequests.updatedAt,
        sourceBranch: mergeRequests.sourceBranch,
        targetBranch: mergeRequests.targetBranch,
        projectSlug: projects.slug,
        projectName: projects.name,
        groupSlug: groups.slug,
        groupName: groups.name,
      })
      .from(mergeRequests)
      .innerJoin(projects, eq(mergeRequests.projectId, projects.id))
      .innerJoin(groups, eq(projects.groupId, groups.id))
      .where(
        and(
          inArray(mergeRequests.projectId, ids),
          or(
            sql`${mergeRequests.title} LIKE ${pattern} ESCAPE '\\'`,
            sql`${mergeRequests.description} LIKE ${pattern} ESCAPE '\\'`
          )
        )
      )
      .orderBy(desc(mergeRequests.updatedAt))
      .limit(input.limit),
  ]);

  return c.json({
    query: input.q,
    projects: projectRows,
    issues: issueRows,
    mergeRequests: mergeRequestRows,
  });
});
