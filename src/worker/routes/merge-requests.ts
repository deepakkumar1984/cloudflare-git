import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
} from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  gitRefs,
  mergeRequestApprovals,
  mergeRequestAssignees,
  mergeRequestReviewers,
  mergeRequests,
  milestones,
  notes,
  user,
  type MergeRequest,
} from "@db/schema";
import {
  atLeast,
  canComment,
  canDeleteNote,
  canMarkMerged,
  canReview,
} from "@shared/permissions";
import {
  mergeRequestCreateSchema,
  mergeRequestUpdateSchema,
  noteCreateSchema,
  paginationSchema,
  reviewerStateSchema,
  userIdSchema,
} from "@shared/schemas";
import type { AppEnv } from "@worker/env";
import { getGitStorage } from "@worker/artifacts";
import {
  assertAuthenticated,
  assertProjectWritable,
  assertRole,
  loadProject,
} from "@worker/services/access";
import { recordEvent } from "@worker/services/events";
import { allocateIid } from "@worker/services/iid";
import { assertAssignableUsers } from "@worker/services/members";
import { isAncestor } from "@worker/services/merge-detection";
import {
  findMergeBase,
  getFilePatch,
  listChangedFiles,
} from "@worker/services/diff";
import { resolveRefSha, validatePath } from "@worker/services/repository";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  readJson,
  readQuery,
} from "@worker/lib/errors";

export const mergeRequestRoutes = new Hono<AppEnv>();

const mrListQuery = paginationSchema.extend({
  state: z.enum(["opened", "merged", "closed", "all"]).default("opened"),
  q: z.string().trim().max(200).optional(),
  author: userIdSchema.optional(),
  assignee: userIdSchema.optional(),
  reviewer: userIdSchema.optional(),
});

const diffFileQuery = z.object({
  path: z.string().min(1).max(4096),
  oldPath: z.string().max(4096).optional(),
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

async function getMrRow(c: Context<AppEnv>, iid: number) {
  const project = c.get("project");
  const [row] = await c
    .get("db")
    .select({
      mr: mergeRequests,
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
    .from(mergeRequests)
    .innerJoin(user, eq(mergeRequests.authorId, user.id))
    .leftJoin(milestones, eq(mergeRequests.milestoneId, milestones.id))
    .where(
      and(eq(mergeRequests.projectId, project.id), eq(mergeRequests.iid, iid))
    )
    .limit(1);
  if (!row) throw notFound("Merge request not found");
  return {
    mr: row.mr,
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

function canEditMr(
  mr: MergeRequest,
  userId: string | undefined,
  role: AppEnv["Variables"]["role"]
): boolean {
  if (!userId) return false;
  if (atLeast(role, "maintainer")) return true;
  return mr.authorId === userId && atLeast(role, "developer");
}

async function loadMrRelations(
  db: AppEnv["Variables"]["db"],
  mr: MergeRequest
) {
  const [assigneeRows, reviewerRows, approvals] = await Promise.all([
    db
      .select({
        person: {
          id: user.id,
          name: user.name,
          username: user.username,
          displayUsername: user.displayUsername,
          image: user.image,
        },
      })
      .from(mergeRequestAssignees)
      .innerJoin(user, eq(mergeRequestAssignees.userId, user.id))
      .where(eq(mergeRequestAssignees.mergeRequestId, mr.id)),
    db
      .select({
        state: mergeRequestReviewers.state,
        requestedAt: mergeRequestReviewers.requestedAt,
        reviewedAt: mergeRequestReviewers.reviewedAt,
        person: {
          id: user.id,
          name: user.name,
          username: user.username,
          displayUsername: user.displayUsername,
          image: user.image,
        },
      })
      .from(mergeRequestReviewers)
      .innerJoin(user, eq(mergeRequestReviewers.userId, user.id))
      .where(eq(mergeRequestReviewers.mergeRequestId, mr.id)),
    db
      .select({ userId: mergeRequestApprovals.userId })
      .from(mergeRequestApprovals)
      .where(
        and(
          eq(mergeRequestApprovals.mergeRequestId, mr.id),
          eq(mergeRequestApprovals.sha, mr.headSha ?? "")
        )
      ),
  ]);
  return {
    assignees: assigneeRows.map((row) => safeUser(row.person)),
    reviewers: reviewerRows.map((row) => ({
      ...safeUser(row.person),
      state: row.state,
      requestedAt: row.requestedAt,
      reviewedAt: row.reviewedAt,
    })),
    approvalCount: approvals.length,
  };
}

async function loadMrView(c: Context<AppEnv>, iid: number) {
  const row = await getMrRow(c, iid);
  const db = c.get("db");
  const project = c.get("project");
  const role = c.get("role");
  const session = c.get("session");
  const relations = await loadMrRelations(db, row.mr);
  const refs = await db
    .select()
    .from(gitRefs)
    .where(
      and(
        eq(gitRefs.projectId, project.id),
        inArray(gitRefs.refName, [
          `refs/heads/${row.mr.sourceBranch}`,
          `refs/heads/${row.mr.targetBranch}`,
        ])
      )
    );
  const sourceRef = refs.find(
    (ref) => ref.refName === `refs/heads/${row.mr.sourceBranch}`
  );
  const targetRef = refs.find(
    (ref) => ref.refName === `refs/heads/${row.mr.targetBranch}`
  );
  const isAuthor = row.mr.authorId === session?.user.id;
  return {
    mergeRequest: {
      id: row.mr.id,
      iid: row.mr.iid,
      title: row.mr.title,
      description: row.mr.description,
      state: row.mr.state,
      draft: row.mr.draft,
      sourceBranch: row.mr.sourceBranch,
      targetBranch: row.mr.targetBranch,
      baseSha: row.mr.baseSha,
      headSha: row.mr.headSha,
      targetSha: row.mr.targetSha,
      sourceSha: sourceRef?.sha ?? row.mr.headSha,
      currentTargetSha: targetRef?.sha ?? row.mr.targetSha,
      sourceBranchExists: Boolean(sourceRef && !sourceRef.deletedAt),
      mergeCommitSha: row.mr.mergeCommitSha,
      mergeDetection: row.mr.mergeDetection,
      mergedAt: row.mr.mergedAt,
      closedAt: row.mr.closedAt,
      createdAt: row.mr.createdAt,
      updatedAt: row.mr.updatedAt,
      author: row.author,
      milestone: row.milestone,
      assignees: relations.assignees,
      reviewers: relations.reviewers,
      approvalCount: relations.approvalCount,
      canEdit: canEditMr(row.mr, session?.user.id, role),
      canReview: canReview(role) && !isAuthor && row.mr.state === "opened",
      canMarkMerged: canMarkMerged(role) && row.mr.state !== "merged",
      approvalFromViewer: relations.reviewers.some(
        (reviewer) =>
          reviewer.id === session?.user.id && reviewer.state === "approved"
      ),
    },
  };
}

async function validateMrRelations(
  db: AppEnv["Variables"]["db"],
  project: AppEnv["Variables"]["project"],
  input: {
    assigneeIds?: string[];
    reviewerIds?: string[];
    milestoneId?: string | null;
  },
  authorId?: string
) {
  if (input.assigneeIds) {
    await assertAssignableUsers(db, project, input.assigneeIds);
  }
  if (input.reviewerIds) {
    if (authorId && input.reviewerIds.includes(authorId)) {
      throw badRequest("You cannot request a review from the author");
    }
    await assertAssignableUsers(db, project, input.reviewerIds);
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

mergeRequestRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const query = readQuery(c, mrListQuery);
    const db = c.get("db");
    const conditions: SQL[] = [eq(mergeRequests.projectId, project.id)];
    if (query.state !== "all")
      conditions.push(eq(mergeRequests.state, query.state));
    if (query.q) {
      conditions.push(
        or(
          ilike(mergeRequests.title, `%${query.q}%`),
          ilike(mergeRequests.description, `%${query.q}%`)
        )!
      );
    }
    if (query.author) conditions.push(eq(mergeRequests.authorId, query.author));
    if (query.assignee) {
      conditions.push(
        inArray(
          mergeRequests.id,
          db
            .select({ id: mergeRequestAssignees.mergeRequestId })
            .from(mergeRequestAssignees)
            .where(eq(mergeRequestAssignees.userId, query.assignee))
        )
      );
    }
    if (query.reviewer) {
      conditions.push(
        inArray(
          mergeRequests.id,
          db
            .select({ id: mergeRequestReviewers.mergeRequestId })
            .from(mergeRequestReviewers)
            .where(eq(mergeRequestReviewers.userId, query.reviewer))
        )
      );
    }
    const where = and(...conditions);

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          mr: mergeRequests,
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
        .from(mergeRequests)
        .innerJoin(user, eq(mergeRequests.authorId, user.id))
        .leftJoin(milestones, eq(mergeRequests.milestoneId, milestones.id))
        .where(where)
        .orderBy(desc(mergeRequests.updatedAt))
        .limit(query.perPage)
        .offset((query.page - 1) * query.perPage),
      db.select({ value: count() }).from(mergeRequests).where(where),
    ]);

    const mrIds = rows.map((row) => row.mr.id);
    const reviewerRows = mrIds.length
      ? await db
          .select({
            mrId: mergeRequestReviewers.mergeRequestId,
            state: mergeRequestReviewers.state,
            person: {
              id: user.id,
              name: user.name,
              username: user.username,
              displayUsername: user.displayUsername,
              image: user.image,
            },
          })
          .from(mergeRequestReviewers)
          .innerJoin(user, eq(mergeRequestReviewers.userId, user.id))
          .where(inArray(mergeRequestReviewers.mergeRequestId, mrIds))
      : [];
    const approvalRows = mrIds.length
      ? await db
          .select({
            mrId: mergeRequestApprovals.mergeRequestId,
            userId: mergeRequestApprovals.userId,
          })
          .from(mergeRequestApprovals)
          .where(inArray(mergeRequestApprovals.mergeRequestId, mrIds))
      : [];
    const reviewersByMr = new Map<string, typeof reviewerRows>();
    for (const row of reviewerRows) {
      const list = reviewersByMr.get(row.mrId) ?? [];
      list.push(row);
      reviewersByMr.set(row.mrId, list);
    }
    const approvalsByMr = new Map<string, number>();
    for (const row of approvalRows) {
      approvalsByMr.set(row.mrId, (approvalsByMr.get(row.mrId) ?? 0) + 1);
    }

    return c.json({
      mergeRequests: rows.map((row) => ({
        id: row.mr.id,
        iid: row.mr.iid,
        title: row.mr.title,
        state: row.mr.state,
        draft: row.mr.draft,
        sourceBranch: row.mr.sourceBranch,
        targetBranch: row.mr.targetBranch,
        mergeDetection: row.mr.mergeDetection,
        createdAt: row.mr.createdAt,
        updatedAt: row.mr.updatedAt,
        author: safeUser(row.author),
        milestone: row.milestone?.id
          ? {
              id: row.milestone.id,
              title: row.milestone.title,
              state: row.milestone.state,
            }
          : null,
        reviewers: (reviewersByMr.get(row.mr.id) ?? []).map((reviewer) => ({
          ...safeUser(reviewer.person),
          state: reviewer.state,
        })),
        approvalCount: approvalsByMr.get(row.mr.id) ?? 0,
      })),
      total: totalRow?.value ?? 0,
      page: query.page,
      perPage: query.perPage,
    });
  }
);

mergeRequestRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    assertRole(c, "developer");
    assertProjectWritable(c);
    const project = c.get("project");
    const input = await readJson(c, mergeRequestCreateSchema);
    if (input.sourceBranch === input.targetBranch) {
      throw badRequest("Source and target branches must differ");
    }
    const db = c.get("db");
    const storage = getGitStorage(c.env);
    const sourceSha = await resolveRefSha(db, project, input.sourceBranch);
    const targetSha = await resolveRefSha(db, project, input.targetBranch);
    if (!sourceSha) throw badRequest("Source branch does not exist");
    if (!targetSha) throw badRequest("Target branch does not exist");
    if (await isAncestor(db, storage, project, sourceSha, targetSha)) {
      throw conflict("Source branch has no commits ahead of the target");
    }
    await validateMrRelations(db, project, input, session.user.id);
    const base = await findMergeBase(storage, project, sourceSha, targetSha);

    const mr = await db.transaction(async (tx) => {
      const iid = await allocateIid(tx, project.id);
      const [created] = await tx
        .insert(mergeRequests)
        .values({
          projectId: project.id,
          iid,
          title: input.title,
          description: input.description,
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
          baseSha: base.sha,
          headSha: sourceSha,
          targetSha,
          authorId: session.user.id,
          milestoneId: input.milestoneId ?? null,
          draft: input.draft,
        })
        .returning();
      if (!created) throw new Error("Could not create merge request");
      const assignees = [...new Set(input.assigneeIds ?? [])];
      if (assignees.length > 0) {
        await tx.insert(mergeRequestAssignees).values(
          assignees.map((userId) => ({
            mergeRequestId: created.id,
            userId,
          }))
        );
      }
      for (const reviewerId of new Set(input.reviewerIds ?? [])) {
        await tx.insert(mergeRequestReviewers).values({
          mergeRequestId: created.id,
          userId: reviewerId,
          requestedById: session.user.id,
        });
      }
      return created;
    });

    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "mr.opened",
      targetType: "merge_request",
      targetId: mr.id,
      targetIid: mr.iid,
      metadata: { title: mr.title },
    });

    return c.json({ ...(await loadMrView(c, mr.iid)) }, 201);
  }
);

mergeRequestRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid",
  loadProject,
  async (c) => {
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    return c.json(await loadMrView(c, iid));
  }
);

mergeRequestRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    if (!canEditMr(row.mr, session.user.id, c.get("role"))) throw forbidden();
    assertProjectWritable(c);
    const input = await readJson(c, mergeRequestUpdateSchema);
    const db = c.get("db");
    const project = c.get("project");
    await validateMrRelations(db, project, input, session.user.id);

    const targetChanged =
      Boolean(input.targetBranch) && input.targetBranch !== row.mr.targetBranch;
    let nextTargetSha: string | null = null;
    let nextBaseSha: string | null = null;
    if (targetChanged && input.targetBranch) {
      if (input.targetBranch === row.mr.sourceBranch) {
        throw badRequest("Source and target branches must differ");
      }
      nextTargetSha = await resolveRefSha(db, project, input.targetBranch);
      if (!nextTargetSha) throw badRequest("Target branch does not exist");
      if (row.mr.headSha) {
        nextBaseSha = (
          await findMergeBase(
            getGitStorage(c.env),
            project,
            row.mr.headSha,
            nextTargetSha
          )
        ).sha;
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(mergeRequests)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.targetBranch === undefined
            ? {}
            : { targetBranch: input.targetBranch }),
          ...(targetChanged
            ? { targetSha: nextTargetSha, baseSha: nextBaseSha }
            : {}),
          ...(input.milestoneId === undefined
            ? {}
            : { milestoneId: input.milestoneId }),
          ...(input.draft === undefined ? {} : { draft: input.draft }),
          updatedAt: new Date(),
        })
        .where(eq(mergeRequests.id, row.mr.id));

      if (input.assigneeIds) {
        await tx
          .delete(mergeRequestAssignees)
          .where(eq(mergeRequestAssignees.mergeRequestId, row.mr.id));
        const ids = [...new Set(input.assigneeIds)];
        if (ids.length > 0) {
          await tx
            .insert(mergeRequestAssignees)
            .values(
              ids.map((userId) => ({ mergeRequestId: row.mr.id, userId }))
            );
        }
      }

      if (input.reviewerIds) {
        await tx
          .delete(mergeRequestApprovals)
          .where(eq(mergeRequestApprovals.mergeRequestId, row.mr.id));
        await tx
          .delete(mergeRequestReviewers)
          .where(eq(mergeRequestReviewers.mergeRequestId, row.mr.id));
        for (const reviewerId of new Set(input.reviewerIds)) {
          await tx.insert(mergeRequestReviewers).values({
            mergeRequestId: row.mr.id,
            userId: reviewerId,
            requestedById: session.user.id,
          });
        }
      }

      if (targetChanged) {
        await tx
          .delete(mergeRequestApprovals)
          .where(eq(mergeRequestApprovals.mergeRequestId, row.mr.id));
        await tx
          .update(mergeRequestReviewers)
          .set({ state: "pending", reviewedAt: null })
          .where(eq(mergeRequestReviewers.mergeRequestId, row.mr.id));
      }
    });

    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: session.user.id,
      action: "mr.updated",
      targetType: "merge_request",
      targetId: row.mr.id,
      targetIid: row.mr.iid,
      metadata: { fields: Object.keys(input) },
    });

    return c.json(await loadMrView(c, iid));
  }
);

mergeRequestRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/close",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    if (!canEditMr(row.mr, session.user.id, c.get("role"))) throw forbidden();
    if (row.mr.state === "merged")
      throw conflict("Merge request is already merged");
    assertProjectWritable(c);
    await c
      .get("db")
      .update(mergeRequests)
      .set({
        state: "closed",
        closedAt: new Date(),
        closedById: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(mergeRequests.id, row.mr.id));
    await recordEvent(c.get("db"), {
      projectId: c.get("project").id,
      groupId: c.get("project").groupId,
      actorId: session.user.id,
      action: "mr.closed",
      targetType: "merge_request",
      targetId: row.mr.id,
      targetIid: row.mr.iid,
    });
    return c.json(await loadMrView(c, iid));
  }
);

mergeRequestRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/reopen",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    if (!canEditMr(row.mr, session.user.id, c.get("role"))) throw forbidden();
    if (row.mr.state === "merged")
      throw conflict("Merged merge requests cannot be reopened");
    assertProjectWritable(c);
    await c
      .get("db")
      .update(mergeRequests)
      .set({
        state: "opened",
        closedAt: null,
        closedById: null,
        updatedAt: new Date(),
      })
      .where(eq(mergeRequests.id, row.mr.id));
    await recordEvent(c.get("db"), {
      projectId: c.get("project").id,
      groupId: c.get("project").groupId,
      actorId: session.user.id,
      action: "mr.reopened",
      targetType: "merge_request",
      targetId: row.mr.id,
      targetIid: row.mr.iid,
    });
    return c.json(await loadMrView(c, iid));
  }
);

mergeRequestRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/mark_merged",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    if (!canMarkMerged(c.get("role"))) throw forbidden();
    assertProjectWritable(c);
    if (row.mr.state === "merged") return c.json(await loadMrView(c, iid));
    const db = c.get("db");
    const [updated] = await db
      .update(mergeRequests)
      .set({
        state: "merged",
        mergeDetection: "manual",
        mergedAt: new Date(),
        mergedById: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(mergeRequests.id, row.mr.id))
      .returning();
    if (!updated) throw notFound("Merge request not found");
    await db.insert(notes).values({
      projectId: c.get("project").id,
      noteableType: "merge_request",
      noteableId: row.mr.id,
      authorId: session.user.id,
      body: "Marked as merged locally by a maintainer.",
      system: true,
    });
    await recordEvent(db, {
      projectId: c.get("project").id,
      groupId: c.get("project").groupId,
      actorId: session.user.id,
      action: "mr.merged",
      targetType: "merge_request",
      targetId: row.mr.id,
      targetIid: row.mr.iid,
      metadata: { detection: "manual" },
    });
    return c.json(await loadMrView(c, iid));
  }
);

mergeRequestRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/review",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    if (!canReview(c.get("role"))) throw forbidden();
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    if (row.mr.authorId === session.user.id) {
      throw forbidden("You cannot review your own merge request");
    }
    if (row.mr.state !== "opened") throw conflict("Merge request is not open");
    assertProjectWritable(c);
    const input = await readJson(c, reviewerStateSchema);
    const db = c.get("db");

    await db
      .insert(mergeRequestReviewers)
      .values({
        mergeRequestId: row.mr.id,
        userId: session.user.id,
        state: input.state,
        requestedById: session.user.id,
        reviewedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          mergeRequestReviewers.mergeRequestId,
          mergeRequestReviewers.userId,
        ],
        set: { state: input.state, reviewedAt: new Date() },
      });

    if (input.state === "approved") {
      await db
        .insert(mergeRequestApprovals)
        .values({
          mergeRequestId: row.mr.id,
          userId: session.user.id,
          sha: row.mr.headSha ?? "",
        })
        .onConflictDoUpdate({
          target: [
            mergeRequestApprovals.mergeRequestId,
            mergeRequestApprovals.userId,
          ],
          set: { sha: row.mr.headSha ?? "", createdAt: new Date() },
        });
    } else {
      await db
        .delete(mergeRequestApprovals)
        .where(
          and(
            eq(mergeRequestApprovals.mergeRequestId, row.mr.id),
            eq(mergeRequestApprovals.userId, session.user.id)
          )
        );
    }

    await recordEvent(db, {
      projectId: c.get("project").id,
      groupId: c.get("project").groupId,
      actorId: session.user.id,
      action: "mr.approved",
      targetType: "merge_request",
      targetId: row.mr.id,
      targetIid: row.mr.iid,
      metadata: { state: input.state },
    });
    return c.json(await loadMrView(c, iid));
  }
);

/* -------------------------------------------------------------------------- */
/* Diff                                                                       */
/* -------------------------------------------------------------------------- */

async function diffContext(c: Context<AppEnv>, iid: number) {
  const row = await getMrRow(c, iid);
  const project = c.get("project");
  const db = c.get("db");
  const refs = await db
    .select()
    .from(gitRefs)
    .where(
      and(
        eq(gitRefs.projectId, project.id),
        inArray(gitRefs.refName, [
          `refs/heads/${row.mr.sourceBranch}`,
          `refs/heads/${row.mr.targetBranch}`,
        ])
      )
    );
  const sourceRef = refs.find(
    (ref) => ref.refName === `refs/heads/${row.mr.sourceBranch}`
  );
  const targetRef = refs.find(
    (ref) => ref.refName === `refs/heads/${row.mr.targetBranch}`
  );
  const source = sourceRef?.sha ?? row.mr.headSha;
  const target = targetRef?.sha ?? row.mr.targetSha;
  if (!source || !target)
    throw conflict("Branches are not available for diffing");
  const storage = getGitStorage(c.env);
  const base = await findMergeBase(storage, project, source, target);
  return { row, source, target, base, storage, sourceRef, targetRef };
}

mergeRequestRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/diff",
  loadProject,
  async (c) => {
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const { row, source, target, base, storage } = await diffContext(c, iid);
    const changed = await listChangedFiles(
      storage,
      c.get("project"),
      base.sha,
      source
    );
    return c.json({
      baseSha: base.sha,
      headSha: source,
      targetSha: target,
      baseOutdated: !base.found,
      files: changed.files,
      truncated: changed.truncated,
      state: row.mr.state,
    });
  }
);

mergeRequestRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/diff/file",
  loadProject,
  async (c) => {
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const query = readQuery(c, diffFileQuery);
    const path = validatePath(query.path);
    if (!path) throw notFound("File not found");
    const oldPath = query.oldPath ? validatePath(query.oldPath) : undefined;
    const { source, base, storage } = await diffContext(c, iid);
    const patch = await getFilePatch(
      storage,
      c.get("project"),
      base.sha,
      source,
      path,
      oldPath
    );
    return c.json({ patch });
  }
);

mergeRequestRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/commits",
  loadProject,
  async (c) => {
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const { row, base, storage, sourceRef } = await diffContext(c, iid);
    if (!sourceRef || sourceRef.deletedAt) {
      return c.json({ commits: [] });
    }
    const log = await storage.log(c.get("project").artifactsRepoName, {
      ref: row.mr.sourceBranch,
      limit: 100,
    });
    const baseIndex = log.findIndex((commit) => commit.hash === base.sha);
    const commits = baseIndex >= 0 ? log.slice(0, baseIndex) : log;
    return c.json({
      commits: commits.map((commit) => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author,
        committedAt: new Date(commit.committedAt * 1_000).toISOString(),
      })),
    });
  }
);

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
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

mergeRequestRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/notes",
  loadProject,
  async (c) => {
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    const db = c.get("db");
    const notesRows = await db
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
        and(
          eq(notes.noteableType, "merge_request"),
          eq(notes.noteableId, row.mr.id)
        )
      )
      .orderBy(asc(notes.createdAt));
    return c.json({
      notes: notesRows.map((item) =>
        noteView(item.note, item.author ? safeUser(item.author) : null)
      ),
    });
  }
);

mergeRequestRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/notes",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    if (!canComment(c.get("role"))) throw forbidden();
    assertProjectWritable(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    const input = await readJson(c, noteCreateSchema);
    const db = c.get("db");
    const [note] = await db
      .insert(notes)
      .values({
        projectId: c.get("project").id,
        noteableType: "merge_request",
        noteableId: row.mr.id,
        authorId: session.user.id,
        body: input.body,
      })
      .returning();
    if (!note) throw new Error("Could not create comment");
    await recordEvent(db, {
      projectId: c.get("project").id,
      groupId: c.get("project").groupId,
      actorId: session.user.id,
      action: "mr.comment",
      targetType: "merge_request",
      targetId: row.mr.id,
      targetIid: row.mr.iid,
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

mergeRequestRoutes.patch(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/notes/:noteId",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    assertProjectWritable(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    const noteId = c.req.param("noteId");
    const input = await readJson(c, noteCreateSchema);
    const db = c.get("db");
    const [note] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.noteableType, "merge_request"),
          eq(notes.noteableId, row.mr.id)
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
    return c.json({
      note: noteView(updated ?? note, {
        id: session.user.id,
        name: session.user.name,
        username: session.user.username ?? null,
        displayUsername: session.user.displayUsername ?? null,
        image: session.user.image ?? null,
      }),
    });
  }
);

mergeRequestRoutes.delete(
  "/groups/:groupSlug/projects/:projectSlug/merge_requests/:iid/notes/:noteId",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    assertProjectWritable(c);
    const iid = Number(c.req.param("iid"));
    if (!Number.isInteger(iid) || iid < 1) {
      throw notFound("Merge request not found");
    }
    const row = await getMrRow(c, iid);
    const noteId = c.req.param("noteId");
    const db = c.get("db");
    const [note] = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.id, noteId),
          eq(notes.noteableType, "merge_request"),
          eq(notes.noteableId, row.mr.id)
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
