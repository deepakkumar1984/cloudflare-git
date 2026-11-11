import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@db/client";
import { auditEvents, events } from "@db/schema";

const CODE_METADATA_FIELDS: Record<string, readonly string[]> = {
  push: ["ref", "before", "after", "repo", "unverifiedAuthor"],
  "project.imported": ["externalRepo", "branch"],
  "project.reimported": ["externalRepo", "branch"],
  "project.import_failed": ["externalRepo", "error"],
};

/**
 * Drops issue titles for everyone, and drops repository details from viewers
 * who are below reporter.
 */
export function presentActivityMetadata(
  action: string,
  metadata: Record<string, unknown> | null | undefined,
  canReadCode: boolean
): Record<string, unknown> {
  const rest = Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key]) => key !== "title")
  );
  if (canReadCode) return rest;
  const hidden = new Set(CODE_METADATA_FIELDS[action] ?? []);
  if (hidden.size === 0) return rest;
  return Object.fromEntries(
    Object.entries(rest).filter(([key]) => !hidden.has(key))
  );
}

/**
 * Hides activity rows that point at a confidential issue the viewer cannot
 * open. `codeProjectIds` are projects where the viewer is reporter or higher.
 * An empty list hides every confidential issue event.
 */
export function readableActivityCondition(codeProjectIds: string[]): SQL {
  if (codeProjectIds.length === 0) {
    return sql`not (
      ${events.targetType} = 'issue'
      and ${events.targetId} in (
        select id from issues where confidential = 1
      )
    )`;
  }
  const list = sql.join(
    codeProjectIds.map((id) => sql`${id}`),
    sql`, `
  );
  return sql`not (
    ${events.targetType} = 'issue'
    and ${events.targetId} in (
      select id from issues
      where confidential = 1
      and project_id not in (${list})
    )
  )`;
}

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
