import { and, eq, ne } from "drizzle-orm";
import type { Database } from "@db/client";
import {
  gitCommits,
  mergeRequestApprovals,
  mergeRequestReviewers,
  mergeRequests,
  notes,
  type MergeRequest,
  type Project,
} from "@db/schema";
import type { GitStorage } from "@worker/artifacts";
import { recordEvent } from "./events";

const MAX_WALK = 1_000;

async function getCommit(
  db: Database,
  storage: GitStorage,
  project: Project,
  hash: string
) {
  const [cached] = await db
    .select()
    .from(gitCommits)
    .where(and(eq(gitCommits.projectId, project.id), eq(gitCommits.sha, hash)))
    .limit(1);
  if (cached) return cached;
  const commit = await storage.readCommit(project.artifactsRepoName, hash);
  if (!commit) return null;
  await db
    .insert(gitCommits)
    .values({
      projectId: project.id,
      sha: commit.hash,
      treeSha: commit.treeHash,
      message: commit.message,
      authorName: commit.author.name,
      authorEmail: commit.author.email,
      committerName: commit.committer.name,
      committerEmail: commit.committer.email,
      authoredAt: new Date(commit.authoredAt * 1000),
      committedAt: new Date(commit.committedAt * 1000),
      parents: commit.parents,
    })
    .onConflictDoUpdate({
      target: [gitCommits.projectId, gitCommits.sha],
      set: {
        treeSha: commit.treeHash,
        parents: commit.parents,
        message: commit.message,
      },
    });
  return {
    projectId: project.id,
    sha: commit.hash,
    treeSha: commit.treeHash,
    message: commit.message,
    authorName: commit.author.name,
    authorEmail: commit.author.email,
    committerName: commit.committer.name,
    committerEmail: commit.committer.email,
    authoredAt: new Date(commit.authoredAt * 1000),
    committedAt: new Date(commit.committedAt * 1000),
    parents: commit.parents,
    createdAt: new Date(),
  };
}

/** Bounded ancestry check: is `ancestor` reachable from `descendant`? */
export async function isAncestor(
  db: Database,
  storage: GitStorage,
  project: Project,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  if (!ancestor || !descendant) return false;
  if (ancestor === descendant) return true;
  const queue = [descendant];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < MAX_WALK) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current === ancestor) return true;
    const commit = await getCommit(db, storage, project, current);
    if (!commit) continue;
    for (const parent of commit.parents) {
      if (!seen.has(parent)) queue.push(parent);
    }
  }
  return false;
}

export async function invalidateApprovals(
  db: Database,
  mergeRequestId: string,
  headSha: string
): Promise<void> {
  await db
    .delete(mergeRequestApprovals)
    .where(
      and(
        eq(mergeRequestApprovals.mergeRequestId, mergeRequestId),
        ne(mergeRequestApprovals.sha, headSha)
      )
    );
  await db
    .update(mergeRequestReviewers)
    .set({ state: "pending", reviewedAt: null })
    .where(
      and(
        eq(mergeRequestReviewers.mergeRequestId, mergeRequestId),
        ne(mergeRequestReviewers.state, "pending")
      )
    );
}

export async function updateOpenMrsForSourcePush(
  db: Database,
  projectId: string,
  sourceBranch: string,
  headSha: string
): Promise<number> {
  const open = await db
    .select()
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.projectId, projectId),
        eq(mergeRequests.sourceBranch, sourceBranch),
        eq(mergeRequests.state, "opened")
      )
    );
  for (const mr of open) {
    if (mr.headSha === headSha) continue;
    await db
      .update(mergeRequests)
      .set({ headSha, updatedAt: new Date() })
      .where(eq(mergeRequests.id, mr.id));
    await invalidateApprovals(db, mr.id, headSha);
  }
  return open.length;
}

type CommitWithParents = {
  hash: string;
  message: string;
  parents: string[];
};

async function markMerged(
  db: Database,
  project: Project,
  mr: MergeRequest,
  targetSha: string,
  detection: "fast_forward" | "merge_commit" | "heuristic"
): Promise<boolean> {
  if (mr.state !== "opened") return false;
  const now = new Date();
  const [updated] = await db
    .update(mergeRequests)
    .set({
      state: "merged",
      mergeCommitSha: targetSha,
      mergeDetection: detection,
      mergedAt: now,
      updatedAt: now,
    })
    .where(and(eq(mergeRequests.id, mr.id), eq(mergeRequests.state, "opened")))
    .returning();
  if (!updated) return false;

  await db.insert(notes).values({
    projectId: project.id,
    noteableType: "merge_request",
    noteableId: mr.id,
    body:
      detection === "heuristic"
        ? `Marked as merged from a push to \`${mr.targetBranch}\` (matched \`!${mr.iid}\`).`
        : `Merged from a push to \`${mr.targetBranch}\`.`,
    system: true,
  });
  await recordEvent(db, {
    projectId: project.id,
    groupId: project.groupId,
    action: "mr.merged",
    targetType: "merge_request",
    targetId: mr.id,
    targetIid: mr.iid,
    metadata: { detection, targetSha },
    dedupeKey: `mr-merged:${mr.id}:${targetSha}`,
  });
  return true;
}

/**
 * Detect whether a target-branch push completes one of the open MRs.
 * FF and normal merge commits are trusted; squash/rebase is only auto-merged
 * when the commit explicitly references the MR as `!iid`.
 */
export async function detectMergesForTargetPush(
  db: Database,
  storage: GitStorage,
  project: Project,
  targetBranch: string,
  beforeSha: string | null,
  afterSha: string,
  commits: CommitWithParents[]
): Promise<number> {
  const open = await db
    .select()
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.projectId, project.id),
        eq(mergeRequests.targetBranch, targetBranch),
        eq(mergeRequests.state, "opened")
      )
    );
  let merged = 0;
  for (const mr of open) {
    if (!mr.headSha) continue;

    if (afterSha === mr.headSha) {
      if (await markMerged(db, project, mr, afterSha, "fast_forward"))
        merged += 1;
      continue;
    }

    const targetCommit =
      commits.find((commit) => commit.hash === afterSha) ??
      (await storage.readCommit(project.artifactsRepoName, afterSha)) ??
      (await getCommit(db, storage, project, afterSha));

    if (
      targetCommit &&
      targetCommit.parents.length >= 2 &&
      beforeSha &&
      targetCommit.parents.includes(beforeSha) &&
      targetCommit.parents.includes(mr.headSha)
    ) {
      if (await markMerged(db, project, mr, afterSha, "merge_commit")) {
        merged += 1;
      }
      continue;
    }

    // Accept "!12", "(!12)", "fix: thing !12" but not "!120" for MR 12.
    const marker = new RegExp(`(^|[^\\w])!${mr.iid}(?!\\d)`);
    if (commits.some((commit) => marker.test(commit.message))) {
      if (await markMerged(db, project, mr, afterSha, "heuristic")) {
        merged += 1;
      }
    }
  }
  return merged;
}
