import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@db/client";
import {
  groupMembers,
  projectMembers,
  todos,
  user,
  type Project,
} from "@db/schema";

export type TodoAction = "assigned" | "review_requested" | "mentioned";
export type TodoTarget = "issue" | "merge_request";

interface TodoInput {
  userIds: string[];
  actorId: string;
  projectId: string;
  action: TodoAction;
  targetType: TodoTarget;
  targetId: string;
  targetIid: number;
  noteId?: string | null;
}

/**
 * Creates one pending to-do per user, skipping the actor and any user who
 * already has a pending to-do for the same target and action.
 */
export async function createTodos(
  db: Database,
  input: TodoInput
): Promise<void> {
  const recipients = [...new Set(input.userIds)].filter(
    (userId) => userId !== input.actorId
  );
  if (recipients.length === 0) return;

  const existing = await db
    .select({ userId: todos.userId })
    .from(todos)
    .where(
      and(
        eq(todos.projectId, input.projectId),
        eq(todos.targetType, input.targetType),
        eq(todos.targetId, input.targetId),
        eq(todos.action, input.action),
        eq(todos.state, "pending"),
        inArray(todos.userId, recipients)
      )
    );
  const already = new Set(existing.map((row) => row.userId));
  const fresh = recipients.filter((userId) => !already.has(userId));
  if (fresh.length === 0) return;

  await db.insert(todos).values(
    fresh.map((userId) => ({
      userId,
      projectId: input.projectId,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetIid: input.targetIid,
      noteId: input.noteId ?? null,
    }))
  );
}

const MENTION_RE = /@([a-z0-9][a-z0-9._-]{1,30})/gi;

/**
 * Parses @username mentions from a comment body and notifies the mentioned
 * users who actually have access to the project.
 */
export async function notifyMentions(
  db: Database,
  input: {
    body: string;
    actorId: string;
    project: Project;
    targetType: TodoTarget;
    targetId: string;
    targetIid: number;
    noteId: string;
  }
): Promise<void> {
  const tokens = [
    ...new Set(
      [...input.body.matchAll(MENTION_RE)].map((match) =>
        match[1]!.toLowerCase()
      )
    ),
  ];
  if (tokens.length === 0) return;

  const mentioned = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        inArray(user.username, tokens),
        // Only notify accounts that can actually see the project.
        inArray(user.id, await projectMemberIds(db, input.project))
      )
    );
  if (mentioned.length === 0) return;

  await createTodos(db, {
    userIds: mentioned.map((row) => row.id),
    actorId: input.actorId,
    projectId: input.project.id,
    action: "mentioned",
    targetType: input.targetType,
    targetId: input.targetId,
    targetIid: input.targetIid,
    noteId: input.noteId,
  });
}

async function projectMemberIds(
  db: Database,
  project: Project
): Promise<string[]> {
  const [direct, inherited] = await Promise.all([
    db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, project.id)),
    db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, project.groupId)),
  ]);
  return [...new Set([...direct, ...inherited].map((row) => row.userId))];
}
