import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { groups, projects, todos, user } from "@db/schema";
import type { AppEnv } from "@worker/env";
import {
  assertAuthenticated,
  confidentialProjectIds,
  viewableProjectIds,
} from "@worker/services/access";
import { notFound, readQuery } from "@worker/lib/errors";

export const todoRoutes = new Hono<AppEnv>();

const listQuery = z.object({
  state: z.enum(["pending", "done", "all"]).optional().default("pending"),
});

/**
 * Hides to-dos that point at a confidential issue the viewer cannot open.
 */
function readableTodoCondition(codeProjectIds: string[]): SQL {
  if (codeProjectIds.length === 0) {
    return sql`not (
      ${todos.targetType} = 'issue'
      and ${todos.targetId} in (select id from issues where confidential = 1)
    )`;
  }
  const list = sql.join(
    codeProjectIds.map((id) => sql`${id}`),
    sql`, `
  );
  return sql`not (
    ${todos.targetType} = 'issue'
    and ${todos.targetId} in (
      select id from issues
      where confidential = 1
      and project_id not in (${list})
    )
  )`;
}

todoRoutes.get("/todos", async (c) => {
  const session = assertAuthenticated(c);
  const db = c.get("db");
  const query = readQuery(c, listQuery);
  const viewable = await viewableProjectIds(db, session);
  if (viewable.length === 0) {
    return c.json({ todos: [], pendingCount: 0 });
  }
  const readable = readableTodoCondition(
    await confidentialProjectIds(db, session)
  );
  const scope = and(
    eq(todos.userId, session.user.id),
    inArray(todos.projectId, viewable),
    readable
  );

  const rows = await db
    .select({
      todo: todos,
      actor: user,
      project: {
        slug: projects.slug,
        name: projects.name,
        groupSlug: groups.slug,
      },
    })
    .from(todos)
    .leftJoin(user, eq(todos.actorId, user.id))
    .innerJoin(projects, eq(todos.projectId, projects.id))
    .innerJoin(groups, eq(projects.groupId, groups.id))
    .where(
      query.state === "all" ? scope : and(scope, eq(todos.state, query.state))
    )
    .orderBy(desc(todos.createdAt))
    .limit(50);

  const [pendingRow] = await db
    .select({ value: count() })
    .from(todos)
    .where(and(scope, eq(todos.state, "pending")));

  return c.json({
    todos: rows.map((row) => ({
      ...row.todo,
      actor: row.actor
        ? {
            id: row.actor.id,
            name: row.actor.name,
            username: row.actor.username,
            image: row.actor.image,
          }
        : null,
      project: row.project,
    })),
    pendingCount: pendingRow?.value ?? 0,
  });
});

todoRoutes.get("/todos/count", async (c) => {
  const session = assertAuthenticated(c);
  const db = c.get("db");
  const viewable = await viewableProjectIds(db, session);
  if (viewable.length === 0) return c.json({ count: 0 });
  const [row] = await db
    .select({ value: count() })
    .from(todos)
    .where(
      and(
        eq(todos.userId, session.user.id),
        inArray(todos.projectId, viewable),
        eq(todos.state, "pending"),
        readableTodoCondition(await confidentialProjectIds(db, session))
      )
    );
  return c.json({ count: row?.value ?? 0 });
});

async function setState(
  c: Context<AppEnv>,
  todoId: string,
  state: "pending" | "done"
) {
  const session = assertAuthenticated(c);
  const db = c.get("db");
  const updated = await db
    .update(todos)
    .set({ state, updatedAt: new Date() })
    .where(eq(todos.id, todoId))
    .returning({ id: todos.id, userId: todos.userId });
  const row = updated[0];
  if (!row || row.userId !== session.user.id) throw notFound("To-do not found");
  return c.json({ id: row.id, state });
}

todoRoutes.post("/todos/:todoId/done", async (c) =>
  setState(c, c.req.param("todoId"), "done")
);
todoRoutes.post("/todos/:todoId/pending", async (c) =>
  setState(c, c.req.param("todoId"), "pending")
);

todoRoutes.post("/todos/done-all", async (c) => {
  const session = assertAuthenticated(c);
  const db = c.get("db");
  const updated = await db
    .update(todos)
    .set({ state: "done", updatedAt: new Date() })
    .where(and(eq(todos.userId, session.user.id), eq(todos.state, "pending")))
    .returning({ id: todos.id });
  return c.json({ updated: updated.length });
});
