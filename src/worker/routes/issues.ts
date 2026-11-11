import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  boardLists,
  boards,
  issueAssignees,
  issueLabels,
  issues,
  labels,
  milestones,
  notes,
  user,
  type Issue,
} from "@db/schema";
import { writeBatch } from "@db/batch";
import { likeContains } from "@shared/like";
import {
  canComment,
  canDeleteNote,
  canEditIssue,
  canViewConfidential,
} from "@shared/permissions";
import {
  issueCreateSchema,
  issueUpdateSchema,
  noteCreateSchema,
  paginationSchema,
  userIdSchema,
} from "@shared/schemas";
import { parseChecklist, toggleChecklistItem } from "@shared/markdown";
import type { AppEnv } from "@worker/env";
import {
  assertAuthenticated,
  assertProjectWritable,
  assertRole,
  loadProject,
} from "@worker/services/access";
import { recordEvent } from "@worker/services/events";
import { allocateIid } from "@worker/services/iid";
import { assertAssignableUsers } from "@worker/services/members";
import {
  badRequest,
  forbidden,
  notFound,
  readJson,
  readQuery,
} from "@worker/lib/errors";
import { boardMoveSchema } from "@shared/schemas";

export const issueRoutes = new Hono<AppEnv>();

const issueListQuery = paginationSchema.extend({
  state: z.enum(["opened", "closed", "all"]).default("opened"),
  q: z.string().trim().max(200).optional(), // truncated to 48 bytes before LIKE
  label: z.string().uuid().optional(),
  assignee: userIdSchema.optional(),
  milestone: z.string().uuid().optional(),
  sort: z.enum(["updated", "created", "iid"]).default("updated"),
});

function safeUser(row: {
  id: string;
  name: string;
  username: string | null;
  displayUsername: string | null;
  image: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    displayUsername: row.displayUsername,
    image: row.image,
  };
}

async function getIssueRow(
  c: Context<AppEnv>,
  iid: number
): Promise<{
  issue: Issue;
  author: ReturnType<typeof safeUser>;
  milestone: { id: string; title: string; state: string } | null;
}> {
  const project = c.get("project");
  const role = c.get("role");
  const db = c.get("db");
  const [row] = await db
    .select({
      issue: issues,
      author: {
        id: user.id,
        name: user.name,
        username: user.username,
        displayUsername: user.displayUsername,
        image: user.image,
      },
      milestone: {
        id: milestones.id,
        title: milestones.title,
        state: milestones.state,
      },
    })
    .from(issues)
    .innerJoin(user, eq(issues.authorId, user.id))
    .leftJoin(milestones, eq(issues.milestoneId, milestones.id))
    .where(and(eq(issues.projectId, project.id), eq(issues.iid, iid)))
    .limit(1);
  if (!row) throw notFound("Issue not found");
  if (row.issue.confidential && !canViewConfidential(role)) {
    throw notFound("Issue not found");
  }
  return {
    issue: row.issue,
    author: safeUser(row.author),
    milestone: row.milestone?.id
      ? {
          id: row.milestone.id,
          title: row.milestone.title,
          state: row.milestone.state,
        }
      : null,
  };
}

async function loadRelations(
  db: AppEnv["Variables"]["db"],
  issueIds: string[]
) {
  if (issueIds.length === 0) {
    return {
      labelsByIssue: new Map<
        string,
        Array<{ id: string; title: string; color: string }>
      >(),
      assigneesByIssue: new Map<string, Array<ReturnType<typeof safeUser>>>(),
    };
  }
  const [labelRows, assigneeRows] = await Promise.all([
    db
      .select({
        issueId: issueLabels.issueId,
        label: { id: labels.id, title: labels.title, color: labels.color },
      })
      .from(issueLabels)
      .innerJoin(labels, eq(issueLabels.labelId, labels.id))
      .where(inArray(issueLabels.issueId, issueIds)),
    db
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
      .where(inArray(issueAssignees.issueId, issueIds)),
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
    Array<ReturnType<typeof safeUser>>
  >();
  for (const row of assigneeRows) {
    const list = assigneesByIssue.get(row.issueId) ?? [];
    list.push(safeUser(row.person));
    assigneesByIssue.set(row.issueId, list);
  }
  return { labelsByIssue, assigneesByIssue };
}

function issueView(
  row: Awaited<ReturnType<typeof getIssueRow>>,
  relations: Awaited<ReturnType<typeof loadRelations>>,
  role: AppEnv["Variables"]["role"],
  viewerId: string | undefined
) {
  const issue = row.issue;
  return {
    id: issue.id,
    iid: issue.iid,
    title: issue.title,
    description: issue.description,
    state: issue.state,
    confidential: issue.confidential,
    dueDate: issue.dueDate,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
    author: row.author,
    milestone: row.milestone,
    labels: relations.labelsByIssue.get(issue.id) ?? [],
    assignees: relations.assigneesByIssue.get(issue.id) ?? [],
    checklist: parseChecklist(issue.description),
    canEdit: canEditIssue(role, issue.authorId === viewerId),
  };
}

async function validateIssueRelations(
  db: AppEnv["Variables"]["db"],
  project: AppEnv["Variables"]["project"],
  input: {
    assigneeIds?: string[];
    labelIds?: string[];
    milestoneId?: string | null;
  }
): Promise<void> {
  if (input.assigneeIds) {
    await assertAssignableUsers(db, project, input.assigneeIds);
  }
  if (input.labelIds && input.labelIds.length > 0) {
    const rows = await db
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.projectId, project.id),
          inArray(labels.id, input.labelIds)
        )
      );
    if (rows.length !== new Set(input.labelIds).size) {
      throw badRequest("One or more labels do not belong to this project");
    }
  }
  if (input.milestoneId) {
    const [milestone] = await db
      .select({ id: milestones.id })
      .from(milestones)
      .where(
        and(
          eq(milestones.id, input.milestoneId),
          eq(milestones.projectId, project.id)
        )
      )
      .limit(1);
    if (!milestone)
      throw badRequest("Milestone does not belong to this project");
  }
}

async function defaultBoardLabelId(
  db: AppEnv["Variables"]["db"],
  projectId: string
): Promise<string | null> {
  const [row] = await db
    .select({ labelId: boardLists.labelId })
    .from(boardLists)
    .innerJoin(boards, eq(boardLists.boardId, boards.id))
    .where(eq(boards.projectId, projectId))
    .orderBy(asc(boardLists.position))
    .limit(1);
  return row?.labelId ?? null;
}

async function boardLabelIds(
  db: AppEnv["Variables"]["db"],
  projectId: string
): Promise<string[]> {
  const rows = await db
    .select({ labelId: boardLists.labelId })
    .from(boardLists)
    .innerJoin(boards, eq(boardLists.boardId, boards.id))
    .where(eq(boards.projectId, projectId));
  return rows.map((row) => row.labelId);
}

issueRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/issues",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const role = c.get("role");
    const session = c.get("session");
    const query = readQuery(c, issueListQuery);
    const db = c.get("db");

    const conditions: SQL[] = [eq(issues.projectId, project.id)];
    if (query.state !== "all") conditions.push(eq(issues.state, query.state));
    if (!canViewConfidential(role)) {
      conditions.push(eq(issues.confidential, false));
    }
    if (query.q) {
      const pattern = likeContains(query.q);
      conditions.push(
        or(
          sql`${issues.title} LIKE ${pattern} ESCAPE '\\'`,
          sql`${issues.description} LIKE ${pattern} ESCAPE '\\'`
        )!
      );
    }
    if (query.label) {
      conditions.push(
        inArray(
          issues.id,
          db
            .select({ id: issueLabels.issueId })
            .from(issueLabels)
            .where(eq(issueLabels.labelId, query.label))
        )
      );
    }
    if (query.assignee) {
      conditions.push(
        inArray(
          issues.id,
          db
            .select({ id: issueAssignees.issueId })
            .from(issueAssignees)
            .where(eq(issueAssignees.userId, query.assignee))
        )
      );
    }
    if (query.milestone) {
      conditions.push(eq(issues.milestoneId, query.milestone));
    }
    const where = and(...conditions);
    const order =
      query.sort === "iid"
        ? desc(issues.iid)
        : query.sort === "created"
          ? desc(issues.createdAt)
          : desc(issues.updatedAt);

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          issue: issues,
          author: {
            id: user.id,
            name: user.name,
            username: user.username,
            displayUsername: user.displayUsername,
            image: user.image,
          },
          milestone: {
            id: milestones.id,
            title: milestones.title,
            state: milestones.state,
          },
        })
        .from(issues)
        .innerJoin(user, eq(issues.authorId, user.id))
        .leftJoin(milestones, eq(issues.milestoneId, milestones.id))
        .where(where)
        .orderBy(order)
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage),
      db.select({ value: count() }).from(issues).where(where),
    ]);

    const relations = await loadRelations(
      db,
      rows.map((row) => row.issue.id)
    );
    const full = rows.map((row) =>
      issueView(
        {
          issue: row.issue,
          author: safeUser(row.author),
          milestone: row.milestone?.id
            ? {
                id: row.milestone.id,
                title: row.milestone.title,
                state: row.milestone.state,
              }
            : null,
        },
        relations,
        role,
        session?.user.id
      )
    );

    return c.json({
      issues: full,
      total: totalRow?.value ?? 0,
      page: query.page,
      perPage: query.perPage,
    });
  }
);

issueRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/issues",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    assertRole(c, "reporter");
    assertProjectWritable(c);
    const input = await readJson(c, issueCreateSchema);
    const db = c.get("db");
    await validateIssueRelations(db, project, input);

    const assignees = [...new Set(input.assigneeIds ?? [])];
    const labelIds = new Set(input.labelIds ?? []);
    const boardLabelSet = new Set(await boardLabelIds(db, project.id));
    if (![...labelIds].some((labelId) => boardLabelSet.has(labelId))) {
      const defaultLabel = await defaultBoardLabelId(db, project.id);
      if (defaultLabel) labelIds.add(defaultLabel);
    }
    const iid = await allocateIid(db, project.id);
    const issueId = crypto.randomUUID();
    const [createdRows] = await writeBatch(db, [
      db
        .insert(issues)
        .values({
          id: issueId,
          projectId: project.id,
          iid,
          title: input.title,
          description: input.description,
          authorId: session.user.id,
          milestoneId: input.milestoneId ?? null,
          dueDate: input.dueDate ?? null,
          confidential: input.confidential,
        })
        .returning(),
      ...(assignees.length > 0
        ? [
            db
              .insert(issueAssignees)
              .values(assignees.map((userId) => ({ issueId, userId }))),
          ]
        : []),
      ...(labelIds.size > 0
        ? [
            db
              .insert(issueLabels)
              .values([...labelIds].map((labelId) => ({ issueId, labelId }))),
          ]
        : []),
    ]);
    const issue = (createdRows as Issue[])[0];
    if (!issue) throw new Error("Could not create issue");

    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "issue.opened",
      targetType: "issue",
      targetId: issue.id,
      targetIid: issue.iid,
      metadata: issue.confidential
        ? { confidential: true }
        : { title: issue.title },
    });

    const row = await getIssueRow(c, issue.iid);
    const relations = await loadRelations(db, [issue.id]);
    return c.json(
      {
        issue: issueView(row, relations, c.get("role"), session.user.id),
      },
      201
    );
  }
);

issueRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid",
  loadProject,
  async (c) => {
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    const row = await getIssueRow(c, iid);
    const relations = await loadRelations(c.get("db"), [row.issue.id]);
    return c.json({
      issue: issueView(
        row,
        relations,
        c.get("role"),
        c.get("session")?.user.id
      ),
    });
  }
);

issueRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    const row = await getIssueRow(c, iid);
    if (!canEditIssue(c.get("role"), row.issue.authorId === session.user.id)) {
      throw forbidden();
    }
    assertProjectWritable(c);
    const project = c.get("project");
    const input = await readJson(c, issueUpdateSchema);
    const db = c.get("db");
    await validateIssueRelations(db, project, input);

    const assigneeIds = input.assigneeIds
      ? [...new Set(input.assigneeIds)]
      : null;
    const labelIds = input.labelIds ? [...new Set(input.labelIds)] : null;
    await writeBatch(db, [
      db
        .update(issues)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.milestoneId === undefined
            ? {}
            : { milestoneId: input.milestoneId }),
          ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
          ...(input.confidential === undefined
            ? {}
            : { confidential: input.confidential }),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, row.issue.id)),
      ...(assigneeIds
        ? [
            db
              .delete(issueAssignees)
              .where(eq(issueAssignees.issueId, row.issue.id)),
            ...(assigneeIds.length > 0
              ? [
                  db.insert(issueAssignees).values(
                    assigneeIds.map((userId) => ({
                      issueId: row.issue.id,
                      userId,
                    }))
                  ),
                ]
              : []),
          ]
        : []),
      ...(labelIds
        ? [
            db.delete(issueLabels).where(eq(issueLabels.issueId, row.issue.id)),
            ...(labelIds.length > 0
              ? [
                  db.insert(issueLabels).values(
                    labelIds.map((labelId) => ({
                      issueId: row.issue.id,
                      labelId,
                    }))
                  ),
                ]
              : []),
          ]
        : []),
    ]);

    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "issue.updated",
      targetType: "issue",
      targetId: row.issue.id,
      targetIid: row.issue.iid,
      metadata: { fields: Object.keys(input) },
    });

    const updated = await getIssueRow(c, iid);
    const relations = await loadRelations(db, [row.issue.id]);
    return c.json({
      issue: issueView(updated, relations, c.get("role"), session.user.id),
    });
  }
);

async function setIssueState(c: Context<AppEnv>, state: "opened" | "closed") {
  const session = assertAuthenticated(c);
  const iid = Number(c.req.param("iid"));
  if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
  const row = await getIssueRow(c, iid);
  if (!canEditIssue(c.get("role"), row.issue.authorId === session.user.id)) {
    throw forbidden();
  }
  assertProjectWritable(c);
  const db = c.get("db");
  await db
    .update(issues)
    .set({
      state,
      closedAt: state === "closed" ? new Date() : null,
      closedById: state === "closed" ? session.user.id : null,
      updatedAt: new Date(),
    })
    .where(eq(issues.id, row.issue.id));
  await recordEvent(db, {
    projectId: c.get("project").id,
    groupId: c.get("project").groupId,
    actorId: session.user.id,
    action: state === "closed" ? "issue.closed" : "issue.reopened",
    targetType: "issue",
    targetId: row.issue.id,
    targetIid: row.issue.iid,
  });
  const updated = await getIssueRow(c, iid);
  const relations = await loadRelations(db, [row.issue.id]);
  return c.json({
    issue: issueView(updated, relations, c.get("role"), session.user.id),
  });
}

issueRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/close",
  loadProject,
  (c) => setIssueState(c, "closed")
);

issueRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/reopen",
  loadProject,
  (c) => setIssueState(c, "opened")
);

issueRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/checklist/:index/toggle",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const iid = Number(c.req.param("iid"));
    const index = Number(c.req.param("index"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    if (!Number.isInteger(index) || index < 0)
      throw badRequest("Invalid checklist item");
    const row = await getIssueRow(c, iid);
    if (!canEditIssue(c.get("role"), row.issue.authorId === session.user.id)) {
      throw forbidden();
    }
    assertProjectWritable(c);
    const next = toggleChecklistItem(row.issue.description, index);
    if (next === null) throw notFound("Checklist item not found");
    await c
      .get("db")
      .update(issues)
      .set({ description: next, updatedAt: new Date() })
      .where(eq(issues.id, row.issue.id));
    return c.json({ description: next, checklist: parseChecklist(next) });
  }
);

issueRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/move",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    assertRole(c, "reporter");
    assertProjectWritable(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    const row = await getIssueRow(c, iid);
    const input = await readJson(c, boardMoveSchema);
    const project = c.get("project");
    const db = c.get("db");
    const [list] = await db
      .select({ labelId: boardLists.labelId, boardId: boardLists.boardId })
      .from(boardLists)
      .innerJoin(boards, eq(boardLists.boardId, boards.id))
      .where(
        and(
          eq(boardLists.id, input.boardListId),
          eq(boards.projectId, project.id)
        )
      )
      .limit(1);
    if (!list) throw badRequest("Board list does not belong to this project");
    const boardLabels = await boardLabelIds(db, project.id);

    await writeBatch(db, [
      ...(boardLabels.length > 0
        ? [
            db
              .delete(issueLabels)
              .where(
                and(
                  eq(issueLabels.issueId, row.issue.id),
                  inArray(issueLabels.labelId, boardLabels)
                )
              ),
          ]
        : []),
      db
        .insert(issueLabels)
        .values({ issueId: row.issue.id, labelId: list.labelId })
        .onConflictDoNothing(),
      db
        .update(issues)
        .set({ updatedAt: new Date() })
        .where(eq(issues.id, row.issue.id)),
    ]);

    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "issue.updated",
      targetType: "issue",
      targetId: row.issue.id,
      targetIid: row.issue.iid,
      metadata: { boardListId: input.boardListId },
    });

    const updated = await getIssueRow(c, iid);
    const relations = await loadRelations(db, [row.issue.id]);
    return c.json({
      issue: issueView(updated, relations, c.get("role"), session.user.id),
    });
  }
);

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

function noteView(
  row: typeof notes.$inferSelect,
  author: ReturnType<typeof safeUser> | null
) {
  return {
    id: row.id,
    body: row.body,
    system: row.system,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author,
  };
}

issueRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/notes",
  loadProject,
  async (c) => {
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    const row = await getIssueRow(c, iid);
    const db = c.get("db");
    const rows = await db
      .select({
        note: notes,
        author: {
          id: user.id,
          name: user.name,
          username: user.username,
          displayUsername: user.displayUsername,
          image: user.image,
        },
      })
      .from(notes)
      .leftJoin(user, eq(notes.authorId, user.id))
      .where(
        and(eq(notes.noteableType, "issue"), eq(notes.noteableId, row.issue.id))
      )
      .orderBy(asc(notes.createdAt));
    return c.json({
      notes: rows.map((item) =>
        noteView(item.note, item.author ? safeUser(item.author) : null)
      ),
    });
  }
);

issueRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/notes",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    if (!canComment(c.get("role"))) throw forbidden();
    assertProjectWritable(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    const row = await getIssueRow(c, iid);
    const input = await readJson(c, noteCreateSchema);
    const db = c.get("db");
    const [note] = await db
      .insert(notes)
      .values({
        projectId: c.get("project").id,
        noteableType: "issue",
        noteableId: row.issue.id,
        authorId: session.user.id,
        body: input.body,
      })
      .returning();
    if (!note) throw new Error("Could not create comment");
    await recordEvent(db, {
      projectId: c.get("project").id,
      groupId: c.get("project").groupId,
      actorId: session.user.id,
      action: "issue.comment",
      targetType: "issue",
      targetId: row.issue.id,
      targetIid: row.issue.iid,
    });
    return c.json(
      {
        note: noteView(note, {
          id: session.user.id,
          name: session.user.name,
          username: session.user.username ?? null,
          displayUsername: session.user.displayUsername ?? null,
          image: session.user.image ?? null,
        }),
      },
      201
    );
  }
);

issueRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/notes/:noteId",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    assertProjectWritable(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    const row = await getIssueRow(c, iid);
    const noteId = c.req.param("noteId");
    const input = await readJson(c, noteCreateSchema);
    const db = c.get("db");
    const [note] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.noteableType, "issue"),
          eq(notes.noteableId, row.issue.id)
        )
      )
      .limit(1);
    if (!note) throw notFound("Comment not found");
    if (!canDeleteNote(c.get("role"), note.authorId === session.user.id)) {
      throw forbidden();
    }
    const [updated] = await db
      .update(notes)
      .set({ body: input.body, updatedAt: new Date() })
      .where(eq(notes.id, note.id))
      .returning();
    return c.json({ note: noteView(updated ?? note, null) });
  }
);

issueRoutes.delete(
  "/groups/:groupSlug/projects/:projectSlug/issues/:iid/notes/:noteId",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    assertProjectWritable(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) throw notFound("Issue not found");
    const row = await getIssueRow(c, iid);
    const noteId = c.req.param("noteId");
    const db = c.get("db");
    const [note] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.noteableType, "issue"),
          eq(notes.noteableId, row.issue.id)
        )
      )
      .limit(1);
    if (!note) throw notFound("Comment not found");
    if (!canDeleteNote(c.get("role"), note.authorId === session.user.id)) {
      throw forbidden();
    }
    await db.delete(notes).where(eq(notes.id, note.id));
    return c.body(null, 204);
  }
);
