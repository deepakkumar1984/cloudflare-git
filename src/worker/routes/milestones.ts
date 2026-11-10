import { and, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { issues, milestones } from "@db/schema";
import { milestoneCreateSchema, milestoneUpdateSchema } from "@shared/schemas";
import type { AppEnv } from "@worker/env";
import {
  assertProjectWritable,
  assertRole,
  loadProject,
} from "@worker/services/access";
import {
  conflict,
  isUniqueViolation,
  notFound,
  readJson,
} from "@worker/lib/errors";

export const milestoneRoutes = new Hono<AppEnv>();

milestoneRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/milestones",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const db = c.get("db");
    const rows = await db
      .select({
        milestone: milestones,
        total: count(issues.id),
        closed: sql<number>`count(case when ${issues.state} = 'closed' then 1 end)`,
      })
      .from(milestones)
      .leftJoin(issues, eq(issues.milestoneId, milestones.id))
      .where(eq(milestones.projectId, project.id))
      .groupBy(milestones.id)
      .orderBy(milestones.dueDate, milestones.title);
    return c.json({
      milestones: rows.map((row) => ({
        ...row.milestone,
        stats: {
          total: Number(row.total),
          closed: Number(row.closed),
          open: Number(row.total) - Number(row.closed),
        },
      })),
    });
  }
);

milestoneRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/milestones",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const input = await readJson(c, milestoneCreateSchema);
    try {
      const [milestone] = await c
        .get("db")
        .insert(milestones)
        .values({
          projectId: c.get("project").id,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate ?? null,
        })
        .returning();
      return c.json(
        {
          milestone: {
            ...milestone,
            stats: { total: 0, closed: 0, open: 0 },
          },
        },
        201
      );
    } catch (error) {
      if (isUniqueViolation(error, "milestones.project_id, milestones.title")) {
        throw conflict("A milestone with that name already exists");
      }
      throw error;
    }
  }
);

milestoneRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug/milestones/:milestoneId",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const milestoneId = c.req.param("milestoneId");
    const input = await readJson(c, milestoneUpdateSchema);
    const db = c.get("db");
    try {
      const [milestone] = await db
        .update(milestones)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
          ...(input.state === undefined ? {} : { state: input.state }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(milestones.id, milestoneId),
            eq(milestones.projectId, c.get("project").id)
          )
        )
        .returning();
      if (!milestone) throw notFound("Milestone not found");
      return c.json({ milestone });
    } catch (error) {
      if (isUniqueViolation(error, "milestones.project_id, milestones.title")) {
        throw conflict("A milestone with that name already exists");
      }
      throw error;
    }
  }
);

milestoneRoutes.delete(
  "/groups/:groupSlug/projects/:projectSlug/milestones/:milestoneId",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const milestoneId = c.req.param("milestoneId");
    const deleted = await c
      .get("db")
      .delete(milestones)
      .where(
        and(
          eq(milestones.id, milestoneId),
          eq(milestones.projectId, c.get("project").id)
        )
      )
      .returning({ id: milestones.id });
    if (deleted.length === 0) throw notFound("Milestone not found");
    return c.body(null, 204);
  }
);
