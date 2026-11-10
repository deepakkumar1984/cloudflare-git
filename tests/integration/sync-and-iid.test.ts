import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@db/client";
import {
  mergeRequestApprovals,
  mergeRequestReviewers,
  mergeRequests,
  user,
  type Project,
} from "@db/schema";
import { FakeGitStorage } from "@worker/artifacts/fake-storage";
import { allocateIid } from "@worker/services/iid";
import {
  detectMergesForTargetPush,
  isAncestor,
  updateOpenMrsForSourcePush,
} from "@worker/services/merge-detection";
import {
  closeTestDatabase,
  getTestDatabase,
  resetDatabase,
} from "../helpers/db";
import { createGroup, createProject, createUser } from "../helpers/fixtures";

let db: Database;
let project: Project;
let author: typeof user.$inferSelect;
let reviewer: typeof user.$inferSelect;
let storage: FakeGitStorage;
let repoName: string;
let baseSha: string;

beforeEach(async () => {
  await resetDatabase();
  db = (await getTestDatabase()).db;
  author = await createUser(db, { name: "Author" });
  reviewer = await createUser(db, { name: "Reviewer" });
  const group = await createGroup(db, author.id);
  project = await createProject(db, {
    group,
    creatorId: author.id,
    name: "Sync Project",
  });
  storage = new FakeGitStorage();
  repoName = project.artifactsRepoName;
  await storage.createRepository(repoName, { setDefaultBranch: "main" });
  baseSha = storage.seedCommit(repoName, {
    branch: "main",
    message: "Base commit",
    files: { "README.md": "base\n" },
  }).hash;
});

afterAll(async () => {
  await closeTestDatabase();
});

function featureBranch(name: string) {
  return storage.seedCommit(repoName, {
    branch: name,
    parentSha: baseSha,
    message: `Feature ${name}`,
    files: { "README.md": `base\n${name}\n` },
  });
}

async function openMergeRequest(input: {
  iid: number;
  sourceBranch: string;
  headSha: string;
}) {
  const [row] = await db
    .insert(mergeRequests)
    .values({
      projectId: project.id,
      iid: input.iid,
      title: `Merge request ${input.iid}`,
      sourceBranch: input.sourceBranch,
      targetBranch: "main",
      baseSha,
      headSha: input.headSha,
      targetSha: baseSha,
      authorId: author.id,
    })
    .returning();
  if (!row) throw new Error("Could not create merge request");
  return row;
}

async function reloadMergeRequest(iid: number) {
  const [row] = await db
    .select()
    .from(mergeRequests)
    .where(
      and(eq(mergeRequests.projectId, project.id), eq(mergeRequests.iid, iid))
    )
    .limit(1);
  if (!row) throw new Error("Merge request missing");
  return row;
}

describe("project IID allocation", () => {
  it("allocates unique, contiguous IIDs under concurrency", async () => {
    const values = await Promise.all(
      Array.from({ length: 20 }, () => allocateIid(db, project.id))
    );
    expect([...values].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1)
    );
  });
});

describe("merge detection", () => {
  it("walks ancestry across merged feature branches", async () => {
    const feature = featureBranch("feature-ancestry");
    const other = featureBranch("other-ancestry");
    const merge = storage.seedCommit(repoName, {
      branch: "main-merge",
      parentShas: [baseSha, feature.hash],
      message: "Merge feature",
      files: { "README.md": "merged\n" },
    });

    await expect(
      isAncestor(db, storage, project, baseSha, feature.hash)
    ).resolves.toBe(true);
    await expect(
      isAncestor(db, storage, project, feature.hash, baseSha)
    ).resolves.toBe(false);
    await expect(
      isAncestor(db, storage, project, feature.hash, merge.hash)
    ).resolves.toBe(true);
    await expect(
      isAncestor(db, storage, project, other.hash, merge.hash)
    ).resolves.toBe(false);
  });

  it("marks a fast-forward target push as merged", async () => {
    const feature = featureBranch("feature-ff");
    await openMergeRequest({
      iid: 1,
      sourceBranch: "feature-ff",
      headSha: feature.hash,
    });

    const merged = await detectMergesForTargetPush(
      db,
      storage,
      project,
      "main",
      baseSha,
      feature.hash,
      [{ hash: feature.hash, message: feature.message, parents: [baseSha] }]
    );

    expect(merged).toBe(1);
    const mr = await reloadMergeRequest(1);
    expect(mr.state).toBe("merged");
    expect(mr.mergeDetection).toBe("fast_forward");
    expect(mr.mergeCommitSha).toBe(feature.hash);
  });

  it("marks a merge commit with the MR head as a parent", async () => {
    const feature = featureBranch("feature-merge");
    const merge = storage.seedCommit(repoName, {
      branch: "main-merge",
      parentShas: [baseSha, feature.hash],
      message: "Merge feature-merge",
      files: { "README.md": "merged\n" },
    });
    await openMergeRequest({
      iid: 2,
      sourceBranch: "feature-merge",
      headSha: feature.hash,
    });

    const merged = await detectMergesForTargetPush(
      db,
      storage,
      project,
      "main",
      baseSha,
      merge.hash,
      [
        {
          hash: merge.hash,
          message: merge.message,
          parents: [baseSha, feature.hash],
        },
      ]
    );

    expect(merged).toBe(1);
    const mr = await reloadMergeRequest(2);
    expect(mr.state).toBe("merged");
    expect(mr.mergeDetection).toBe("merge_commit");
    expect(mr.mergeCommitSha).toBe(merge.hash);
  });

  it("only auto-merges a squash when the commit references the MR", async () => {
    const feature = featureBranch("feature-squash");
    const unrelated = storage.seedCommit(repoName, {
      branch: "main-unrelated",
      parentSha: baseSha,
      message: "Unrelated work",
      files: { "README.md": "unrelated\n" },
    });
    await openMergeRequest({
      iid: 3,
      sourceBranch: "feature-squash",
      headSha: feature.hash,
    });

    const notMerged = await detectMergesForTargetPush(
      db,
      storage,
      project,
      "main",
      baseSha,
      unrelated.hash,
      [
        {
          hash: unrelated.hash,
          message: unrelated.message,
          parents: [baseSha],
        },
      ]
    );
    expect(notMerged).toBe(0);
    expect((await reloadMergeRequest(3)).state).toBe("opened");

    const squash = storage.seedCommit(repoName, {
      branch: "main-squash",
      parentSha: baseSha,
      message: "Squash feature (!3)",
      files: { "README.md": "squashed\n" },
    });
    const merged = await detectMergesForTargetPush(
      db,
      storage,
      project,
      "main",
      baseSha,
      squash.hash,
      [
        {
          hash: squash.hash,
          message: squash.message,
          parents: [baseSha],
        },
      ]
    );
    expect(merged).toBe(1);
    const mr = await reloadMergeRequest(3);
    expect(mr.state).toBe("merged");
    expect(mr.mergeDetection).toBe("heuristic");
  });

  it("invalidates approvals when the source branch advances", async () => {
    const feature = featureBranch("feature-approvals");
    const next = storage.seedCommit(repoName, {
      branch: "feature-approvals",
      message: "Address review",
      files: { "README.md": "updated\n" },
    });
    const mr = await openMergeRequest({
      iid: 4,
      sourceBranch: "feature-approvals",
      headSha: feature.hash,
    });
    await db.insert(mergeRequestReviewers).values({
      mergeRequestId: mr.id,
      userId: reviewer.id,
      requestedById: author.id,
      state: "approved",
      reviewedAt: new Date(),
    });
    await db.insert(mergeRequestApprovals).values({
      mergeRequestId: mr.id,
      userId: reviewer.id,
      sha: feature.hash,
    });

    await updateOpenMrsForSourcePush(
      db,
      project.id,
      "feature-approvals",
      next.hash
    );

    const updated = await reloadMergeRequest(4);
    expect(updated.headSha).toBe(next.hash);
    expect(
      await db
        .select()
        .from(mergeRequestApprovals)
        .where(eq(mergeRequestApprovals.mergeRequestId, mr.id))
    ).toHaveLength(0);
    const [review] = await db
      .select()
      .from(mergeRequestReviewers)
      .where(eq(mergeRequestReviewers.mergeRequestId, mr.id))
      .limit(1);
    expect(review?.state).toBe("pending");
  });
});
