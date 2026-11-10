import { and, count, eq, isNull } from "drizzle-orm";
import type { Database } from "@db/client";
import { gitRefs, gitSyncRuns, projects } from "@db/schema";
import { SYNC_LEASE_SECONDS } from "@shared/constants";
import type { GitStorage } from "@worker/artifacts";
import { recordEvent } from "./events";
import {
  detectMergesForTargetPush,
  updateOpenMrsForSourcePush,
} from "./merge-detection";
import {
  toCommitInput,
  upsertCommits,
  type CommitMetadataInput,
} from "./repository";
import { acquireSyncLease, releaseSyncLease } from "./sync-lease";

const ZERO_SHA = /^0{40}$/;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export interface NormalizedPushEvent {
  namespace: string | null;
  repoName: string;
  ref: string;
  before: string | null;
  after: string;
  commits: CommitMetadataInput[];
  commitsTruncated: boolean;
  eventTimestamp: Date;
}

function normalizeCommit(value: unknown): CommitMetadataInput | null {
  const commit = record(value);
  if (!commit) return null;
  const hash = text(commit.id) ?? text(commit.hash);
  if (!hash) return null;
  const message = text(commit.message) ?? "";
  const author = record(commit.author);
  const committer = record(commit.committer);
  const timestamp =
    text(commit.timestamp) ??
    text(commit.committedAt) ??
    new Date().toISOString();
  const date = new Date(timestamp);
  const authored = Number.isNaN(date.getTime()) ? new Date() : date;
  return {
    hash,
    treeHash: text(commit.treeHash) ?? undefined,
    message,
    author: {
      name: text(author?.name) ?? "Unknown",
      email: text(author?.email) ?? "",
    },
    committer: {
      name: text(committer?.name) ?? "Unknown",
      email: text(committer?.email) ?? "",
    },
    parents: Array.isArray(commit.parents)
      ? commit.parents.filter(
          (parent): parent is string => typeof parent === "string"
        )
      : [],
    authoredAt: authored,
    committedAt: authored,
  };
}

/**
 * Accepts the full Artifacts event envelope, the inner push payload, or a
 * Workflow event that wraps either one. Keeping this normalization isolated
 * means a payload-shape change cannot spread through the sync code.
 */
export function normalizePushEvent(input: unknown): NormalizedPushEvent | null {
  const root = record(input);
  if (!root) return null;

  const candidate =
    text(root.type) === "cf.artifacts.repo.pushed"
      ? root
      : record(root.payload)?.type === "cf.artifacts.repo.pushed"
        ? (record(root.payload) as JsonRecord)
        : root;

  const source = record(candidate.source) ?? record(root.source);
  const payload =
    record(candidate.payload) ??
    (text(candidate.ref) ? candidate : record(root.payload)) ??
    candidate;
  const metadata = record(candidate.metadata) ?? record(root.metadata);

  const ref = text(payload.ref) ?? text(candidate.ref);
  const after = text(payload.after) ?? text(candidate.after);
  const repoName =
    text(source?.repoName) ??
    text(candidate.repoName) ??
    text(root.repoName) ??
    text(payload.repoName);
  if (!ref || !after || !repoName) return null;

  const eventTimestamp = new Date(
    text(metadata?.eventTimestamp) ??
      text(candidate.eventTimestamp) ??
      new Date().toISOString()
  );

  return {
    namespace: text(source?.namespace) ?? text(candidate.namespace) ?? null,
    repoName,
    ref,
    before: text(payload.before) ?? text(candidate.before) ?? null,
    after,
    commits: Array.isArray(payload.commits)
      ? payload.commits
          .map(normalizeCommit)
          .filter((commit): commit is CommitMetadataInput => Boolean(commit))
      : [],
    commitsTruncated: Boolean(
      payload.commitsTruncated ?? candidate.commitsTruncated
    ),
    eventTimestamp: Number.isNaN(eventTimestamp.getTime())
      ? new Date()
      : eventTimestamp,
  };
}

function refParts(
  ref: string
): { type: "branch" | "tag"; name: string } | null {
  if (ref.startsWith("refs/heads/")) {
    return { type: "branch", name: ref.slice("refs/heads/".length) };
  }
  if (ref.startsWith("refs/tags/")) {
    return { type: "tag", name: ref.slice("refs/tags/".length) };
  }
  return null;
}

export interface SyncResult {
  status: "synced" | "busy" | "ignored" | "stale";
  projectId?: string;
  ref?: string;
  merged?: number;
}

export async function syncPushEvent(
  db: Database,
  storage: GitStorage,
  env: Env,
  raw: unknown,
  workflowId?: string
): Promise<SyncResult> {
  const event = normalizePushEvent(raw);
  if (!event) {
    console.warn(
      "artifacts_push_event_unrecognized",
      JSON.stringify(raw).slice(0, 2_000)
    );
    return { status: "ignored" };
  }
  if (event.namespace && event.namespace !== env.ARTIFACTS_NAMESPACE) {
    return { status: "ignored" };
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.artifactsRepoName, event.repoName),
        eq(projects.artifactsNamespace, env.ARTIFACTS_NAMESPACE)
      )
    )
    .limit(1);
  if (!project) return { status: "ignored" };

  const holder = crypto.randomUUID();
  const acquired = await acquireSyncLease(
    db,
    project.id,
    holder,
    SYNC_LEASE_SECONDS
  );
  if (!acquired)
    return { status: "busy", projectId: project.id, ref: event.ref };

  const parts = refParts(event.ref);
  try {
    await db
      .insert(gitSyncRuns)
      .values({
        projectId: project.id,
        refName: event.ref,
        beforeSha: event.before,
        afterSha: event.after,
        status: "running",
        workflowId: workflowId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          gitSyncRuns.projectId,
          gitSyncRuns.refName,
          gitSyncRuns.afterSha,
        ],
        set: {
          status: "running",
          error: null,
          workflowId: workflowId ?? null,
        },
      });

    if (!parts) {
      await db
        .update(gitSyncRuns)
        .set({ status: "skipped" })
        .where(
          and(
            eq(gitSyncRuns.projectId, project.id),
            eq(gitSyncRuns.refName, event.ref),
            eq(gitSyncRuns.afterSha, event.after)
          )
        );
      return { status: "ignored", projectId: project.id };
    }

    const [existingRef] = await db
      .select()
      .from(gitRefs)
      .where(
        and(eq(gitRefs.projectId, project.id), eq(gitRefs.refName, event.ref))
      )
      .limit(1);
    if (
      existingRef?.lastEventAt &&
      event.eventTimestamp < existingRef.lastEventAt
    ) {
      await db
        .update(gitSyncRuns)
        .set({ status: "skipped", error: "stale event" })
        .where(
          and(
            eq(gitSyncRuns.projectId, project.id),
            eq(gitSyncRuns.refName, event.ref),
            eq(gitSyncRuns.afterSha, event.after)
          )
        );
      return { status: "stale", projectId: project.id, ref: event.ref };
    }

    if (ZERO_SHA.test(event.after)) {
      if (existingRef) {
        await db
          .update(gitRefs)
          .set({
            deletedAt: new Date(),
            lastEventAt: event.eventTimestamp,
            updatedAt: new Date(),
          })
          .where(eq(gitRefs.id, existingRef.id));
      }
      await recordEvent(db, {
        projectId: project.id,
        groupId: project.groupId,
        action: "push",
        targetType: "ref",
        targetId: event.ref,
        metadata: {
          ref: event.ref,
          before: event.before,
          after: event.after,
          deleted: true,
          repo: event.repoName,
        },
        dedupeKey: `push:${project.id}:${event.ref}:${event.after}`,
      });
      await finishRun(db, project.id, event.ref, event.after);
      await db
        .update(projects)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      return { status: "synced", projectId: project.id, ref: event.ref };
    }

    let commits = event.commits;
    if (
      parts.type === "branch" &&
      (event.commitsTruncated ||
        commits.length === 0 ||
        !commits.some((c) => c.hash === event.after))
    ) {
      try {
        const fetched = await storage.log(project.artifactsRepoName, {
          ref: parts.name,
          limit: 1_000,
        });
        const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
        for (const commit of fetched.map(toCommitInput)) {
          if (!byHash.has(commit.hash)) byHash.set(commit.hash, commit);
        }
        commits = [...byHash.values()];
      } catch (error) {
        console.warn("artifacts_log_fallback_failed", error);
      }
    }

    await upsertCommits(db, project.id, commits);

    const [branchCount] = await db
      .select({ value: count() })
      .from(gitRefs)
      .where(
        and(
          eq(gitRefs.projectId, project.id),
          eq(gitRefs.refType, "branch"),
          isNull(gitRefs.deletedAt)
        )
      );

    await db
      .insert(gitRefs)
      .values({
        projectId: project.id,
        refName: event.ref,
        refType: parts.type,
        sha: event.after,
        lastEventAt: event.eventTimestamp,
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: [gitRefs.projectId, gitRefs.refName],
        set: {
          sha: event.after,
          refType: parts.type,
          deletedAt: null,
          lastEventAt: event.eventTimestamp,
          updatedAt: new Date(),
        },
      });

    const isFirstBranch =
      parts.type === "branch" && (branchCount?.value ?? 0) === 0;
    if (isFirstBranch) {
      await db
        .update(projects)
        .set({
          defaultBranch: parts.name,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id));
    } else {
      await db
        .update(projects)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(projects.id, project.id));
    }

    let merged = 0;
    if (parts.type === "branch") {
      await updateOpenMrsForSourcePush(db, project.id, parts.name, event.after);
      merged = await detectMergesForTargetPush(
        db,
        storage,
        project,
        parts.name,
        event.before,
        event.after,
        commits.map((commit) => ({
          hash: commit.hash,
          message: commit.message,
          parents: commit.parents,
        }))
      );
    }

    const firstCommit = commits[0];
    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      action: "push",
      targetType: "ref",
      targetId: event.ref,
      metadata: {
        ref: event.ref,
        before: event.before,
        after: event.after,
        commitCount: commits.length,
        unverifiedAuthor: firstCommit
          ? {
              name: firstCommit.author.name,
              email: firstCommit.author.email,
            }
          : null,
        repo: event.repoName,
      },
      dedupeKey: `push:${project.id}:${event.ref}:${event.after}`,
    });

    await finishRun(db, project.id, event.ref, event.after);
    return {
      status: "synced",
      projectId: project.id,
      ref: event.ref,
      merged,
    };
  } catch (error) {
    await db
      .update(gitSyncRuns)
      .set({
        status: "failed",
        error:
          error instanceof Error
            ? error.message.slice(0, 1_000)
            : String(error),
      })
      .where(
        and(
          eq(gitSyncRuns.projectId, project.id),
          eq(gitSyncRuns.refName, event.ref),
          eq(gitSyncRuns.afterSha, event.after)
        )
      );
    throw error;
  } finally {
    await releaseSyncLease(db, project.id, holder);
  }
}

async function finishRun(
  db: Database,
  projectId: string,
  refName: string,
  afterSha: string
): Promise<void> {
  await db
    .update(gitSyncRuns)
    .set({ status: "completed" })
    .where(
      and(
        eq(gitSyncRuns.projectId, projectId),
        eq(gitSyncRuns.refName, refName),
        eq(gitSyncRuns.afterSha, afterSha)
      )
    );
}
