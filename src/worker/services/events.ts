import type { Database } from "@db/client";
import { auditEvents, events } from "@db/schema";

export type EventAction =
  | "group.created"
  | "group.updated"
  | "group.archived"
  | "group.member_added"
  | "group.member_updated"
  | "group.member_removed"
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "project.imported"
  | "project.reimported"
  | "project.import_failed"
  | "project.member_added"
  | "project.member_updated"
  | "project.member_removed"
  | "issue.opened"
  | "issue.updated"
  | "issue.closed"
  | "issue.reopened"
  | "issue.comment"
  | "mr.opened"
  | "mr.updated"
  | "mr.closed"
  | "mr.reopened"
  | "mr.merged"
  | "mr.approved"
  | "mr.comment"
  | "mr.review_requested"
  | "push";

export async function recordEvent(
  db: Database,
  input: {
    projectId?: string | null;
    groupId?: string | null;
    actorId?: string | null;
    action: EventAction;
    targetType?: string | null;
    targetId?: string | null;
    targetIid?: number | null;
    metadata?: Record<string, unknown>;
    dedupeKey?: string | null;
  }
): Promise<void> {
  await db
    .insert(events)
    .values({
      projectId: input.projectId ?? null,
      groupId: input.groupId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetIid: input.targetIid ?? null,
      metadata: input.metadata ?? {},
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: events.dedupeKey });
}

export async function recordAudit(
  db: Database,
  input: {
    actorId?: string | null;
    projectId?: string | null;
    groupId?: string | null;
    action: string;
    detail?: Record<string, unknown>;
    ipAddress?: string | null;
  }
): Promise<void> {
  await db.insert(auditEvents).values({
    actorId: input.actorId ?? null,
    projectId: input.projectId ?? null,
    groupId: input.groupId ?? null,
    action: input.action,
    detail: input.detail ?? {},
    ipAddress: input.ipAddress ?? null,
  });
}
