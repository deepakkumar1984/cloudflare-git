import { and, asc, eq, inArray, max } from "drizzle-orm";
import { Hono } from "hono";
import {
  boardLists,
  boards,
  issueAssignees,
  issueLabels,
  issues,
  labels,
  user,
} from "@db/schema";
import { canViewConfidential } from "@shared/permissions";
import { boardListCreateSchema } from "@shared/schemas";
import type { AppEnv } from "@worker/env";
import {
  assertProjectWritable,
  assertRole,
  loadProject,
} from "@worker/services/access";
import { badRequest, conflict, notFound, readJson } from "@worker/lib/errors";

export const boardRoutes = new Hono<AppEnv>();

async function getOrCreateBoard(
  db: AppEnv["Variables"]["db"],
  projectId: string
) {
  const [existing] = await db
    .select()
    .from(boards)
    .where(eq(boards.projectId, projectId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(boards).values({ projectId }).returning();
  return created!;
}

boardRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/boards",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const role = c.get("role");
    const db = c.get("db");
    const board = await getOrCreateBoard(db, project.id);

    const lists = await db
      .select({
        id: boardLists.id,
        name: boardLists.name,
        position: boardLists.position,
        label: { id: labels.id, title: labels.title, color: labels.color },
      })
      .from(boardLists)
      .innerJoin(labels, eq(boardLists.labelId, labels.id))
      .where(eq(boardLists.boardId, board.id))
      .orderBy(asc(boardLists.position));

    const rawIssues = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.projectId, project.id),
          eq(issues.state, "opened"),
          canViewConfidential(role) ? undefined : eq(issues.confidential, false)
        )
      )
      .orderBy(asc(issues.iid));
    const issueIds = rawIssues.map((issue) => issue.id);

    const [labelRows, assigneeRows] = await Promise.all([
      issueIds.length
        ? db
            .select({
              issueId: issueLabels.issueId,
              label: {
                id: labels.id,
                title: labels.title,
                color: labels.color,
              },
            })
            .from(issueLabels)
            .innerJoin(labels, eq(issueLabels.labelId, labels.id))
            .where(inArray(issueLabels.issueId, issueIds))
        : Promise.resolve([]),
      issueIds.length
        ? db
            .select({
              issueId: issueAssignees.issueId,
              person: {
                id: user.id,
                name: user.name,
                username: user.username,
                displayUsername: user.displayUsername,
                image: user.image,
              },
            })
            .from(issueAssignees)
            .innerJoin(user, eq(issueAssignees.userId, user.id))
            .where(inArray(issueAssignees.issueId, issueIds))
        : Promise.resolve([]),
    ]);

    const labelsByIssue = new Map<
      string,
      Array<{ id: string; title: string; color: string }>
    >();
    for (const row of labelRows) {
      const list = labelsByIssue.get(row.issueId) ?? [];
      list.push(row.label);
      labelsByIssue.set(row.issueId, list);
    }
    const assigneesByIssue = new Map<
      string,
      Array<{
        id: string;
        name: string;
        username: string | null;
        displayUsername: string | null;
        image: string | null;
      }>
    >();
    for (const row of assigneeRows) {
      const list = assigneesByIssue.get(row.issueId) ?? [];
      list.push(row.person);
      assigneesByIssue.set(row.issueId, list);
    }

    const listByLabel = new Map(lists.map((list) => [list.label.id, list.id]));
    const grouped = new Map<string, typeof rawIssues>();
    const unlisted: typeof rawIssues = [];
    for (const issue of rawIssues) {
      const issueLabelIds = (labelsByIssue.get(issue.id) ?? []).map(
        (label) => label.id
      );
      const listId = issueLabelIds
        .map((labelId) => listByLabel.get(labelId))
        .find(Boolean);
      if (!listId) {
        unlisted.push(issue);
        continue;
      }
      const bucket = grouped.get(listId) ?? [];
      bucket.push(issue);
      grouped.set(listId, bucket);
    }

    const card = (issue: (typeof rawIssues)[number]) => ({
      id: issue.id,
      iid: issue.iid,
      title: issue.title,
      confidential: issue.confidential,
      updatedAt: issue.updatedAt,
      labels: labelsByIssue.get(issue.id) ?? [],
      assignees: assigneesByIssue.get(issue.id) ?? [],
    });

    return c.json({
      board: { id: board.id, name: board.name },
      lists: lists.map((list) => ({
        ...list,
        issues: (grouped.get(list.id) ?? []).map(card),
      })),
      unlisted: unlisted.map(card),
      canManage: ["maintainer", "owner"].includes(role ?? ""),
    });
  }
);

boardRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/boards/lists",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const project = c.get("project");
    const input = await readJson(c, boardListCreateSchema);
    const db = c.get("db");
    const [label] = await db
      .select()
      .from(labels)
      .where(
        and(eq(labels.id, input.labelId), eq(labels.projectId, project.id))
      )
      .limit(1);
    if (!label) throw badRequest("Label does not belong to this project");
    const board = await getOrCreateBoard(db, project.id);
    const [positionRow] = await db
      .select({ value: max(boardLists.position) })
      .from(boardLists)
      .where(eq(boardLists.boardId, board.id));
    const position = (positionRow?.value ?? -1) + 1;
    try {
      const [list] = await db
        .insert(boardLists)
        .values({
          boardId: board.id,
          labelId: label.id,
          name: input.name,
          position,
        })
        .returning();
      return c.json(
        {
          list: {
            ...list,
            label: { id: label.id, title: label.title, color: label.color },
            issues: [],
          },
        },
        201
      );
    } catch {
      throw conflict("Could not create board column");
    }
  }
);

boardRoutes.delete(
  "/groups/:groupSlug/projects/:projectSlug/boards/lists/:listId",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const listId = c.req.param("listId");
    const board = await getOrCreateBoard(c.get("db"), c.get("project").id);
    const deleted = await c
      .get("db")
      .delete(boardLists)
      .where(and(eq(boardLists.id, listId), eq(boardLists.boardId, board.id)))
      .returning({ id: boardLists.id });
    if (deleted.length === 0) throw notFound("Board column not found");
    return c.body(null, 204);
  }
);
