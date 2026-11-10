import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { issueLabels, issues, labels } from "@db/schema";
import { labelCreateSchema, labelUpdateSchema } from "@shared/schemas";
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

export const labelRoutes = new Hono<AppEnv>();

labelRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/labels",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const db = c.get("db");
    const rows = await db
      .select({
        label: labels,
        openIssues: count(issues.id),
      })
      .from(labels)
      .leftJoin(issueLabels, eq(issueLabels.labelId, labels.id))
      .leftJoin(
        issues,
        and(eq(issueLabels.issueId, issues.id), eq(issues.state, "opened"))
      )
      .where(eq(labels.projectId, project.id))
      .groupBy(labels.id)
      .orderBy(labels.title);
    return c.json({
      labels: rows.map((row) => ({
        ...row.label,
        openIssues: row.openIssues,
      })),
    });
  }
);

labelRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/labels",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const input = await readJson(c, labelCreateSchema);
    try {
      const [label] = await c
        .get("db")
        .insert(labels)
        .values({
          projectId: c.get("project").id,
          title: input.title,
          color: input.color,
          description: input.description,
        })
        .returning();
      return c.json({ label: { ...label, openIssues: 0 } }, 201);
    } catch (error) {
      if (isUniqueViolation(error, "labels_project_title_uq")) {
        throw conflict("A label with that name already exists");
      }
      throw error;
    }
  }
);

labelRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug/labels/:labelId",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const labelId = c.req.param("labelId");
    const input = await readJson(c, labelUpdateSchema);
    const db = c.get("db");
    try {
      const [label] = await db
        .update(labels)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          updatedAt: new Date(),
        })
        .where(
          and(eq(labels.id, labelId), eq(labels.projectId, c.get("project").id))
        )
        .returning();
      if (!label) throw notFound("Label not found");
      return c.json({ label });
    } catch (error) {
      if (isUniqueViolation(error, "labels_project_title_uq")) {
        throw conflict("A label with that name already exists");
      }
      throw error;
    }
  }
);

labelRoutes.delete(
  "/groups/:groupSlug/projects/:projectSlug/labels/:labelId",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const labelId = c.req.param("labelId");
    const deleted = await c
      .get("db")
      .delete(labels)
      .where(
        and(eq(labels.id, labelId), eq(labels.projectId, c.get("project").id))
      )
      .returning({ id: labels.id });
    if (deleted.length === 0) throw notFound("Label not found");
    return c.body(null, 204);
  }
);
