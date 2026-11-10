import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@db/schema";
import { FakeGitStorage } from "@worker/artifacts/fake-storage";
import {
  findMergeBase,
  getFilePatch,
  listChangedFiles,
} from "@worker/services/diff";

let storage: FakeGitStorage;
let project: Project;
let repoName: string;

beforeEach(async () => {
  storage = new FakeGitStorage();
  repoName = `p-${Math.random().toString(16).slice(2, 14)}`;
  await storage.createRepository(repoName, { setDefaultBranch: "main" });
  project = {
    id: "00000000-0000-4000-8000-000000000001",
    artifactsRepoName: repoName,
    artifactsNamespace: "cloudflare-git",
  } as Project;
});

function seedBase() {
  return storage.seedCommit(repoName, {
    branch: "main",
    message: "Base",
    files: {
      "README.md": "hello\n",
      "src/a.ts": "export const a = 1;\n",
      "docs/old.md": "rename me\n",
      "keep.txt": "keep\n",
    },
  });
}

function seedFeature(parentSha: string) {
  return storage.seedCommit(repoName, {
    branch: "feature",
    parentSha,
    message: "Feature",
    files: {
      "README.md": "hello world\n",
      "src/a.ts": "export const a = 1;\n",
      "docs/new.md": "rename me\n",
      "keep.txt": "keep\n",
      "CHANGELOG.md": "new file\n",
    },
  });
}

describe("merge base and changed files", () => {
  it("finds the common ancestor across divergent branches", async () => {
    const base = seedBase();
    const feature = seedFeature(base.hash);
    const other = storage.seedCommit(repoName, {
      branch: "other",
      parentSha: base.hash,
      message: "Other",
      files: { "other.txt": "other\n" },
    });

    await expect(
      findMergeBase(storage, project, feature.hash, other.hash)
    ).resolves.toEqual({ sha: base.hash, found: true });
  });

  it("lists modified, added, and exact-rename entries", async () => {
    const base = seedBase();
    const feature = seedFeature(base.hash);
    const result = await listChangedFiles(
      storage,
      project,
      base.hash,
      feature.hash
    );

    expect(result.truncated).toBe(false);
    expect(result.files).toEqual([
      {
        path: "CHANGELOG.md",
        oldPath: null,
        status: "added",
        hash: expect.any(String),
        oldHash: null,
      },
      {
        path: "docs/new.md",
        oldPath: "docs/old.md",
        status: "renamed",
        hash: expect.any(String),
        oldHash: expect.any(String),
      },
      {
        path: "README.md",
        oldPath: "README.md",
        status: "modified",
        hash: expect.any(String),
        oldHash: expect.any(String),
      },
    ]);
  });

  it("returns no files for an identical base and head", async () => {
    const base = seedBase();
    await expect(
      listChangedFiles(storage, project, base.hash, base.hash)
    ).resolves.toEqual({ files: [], truncated: false });
  });
});

describe("file patches", () => {
  it("renders a text hunk with additions and deletions", async () => {
    const base = seedBase();
    const feature = seedFeature(base.hash);
    const patch = await getFilePatch(
      storage,
      project,
      base.hash,
      feature.hash,
      "README.md"
    );
    expect(patch.status).toBe("modified");
    expect(patch.binary).toBe(false);
    expect(patch.additions).toBe(1);
    expect(patch.deletions).toBe(1);
    expect(patch.hunks).toHaveLength(1);
    expect(patch.hunks[0]?.lines).toContain("-hello");
    expect(patch.hunks[0]?.lines).toContain("+hello world");
  });

  it("renders an added file", async () => {
    const base = seedBase();
    const feature = seedFeature(base.hash);
    const patch = await getFilePatch(
      storage,
      project,
      base.hash,
      feature.hash,
      "CHANGELOG.md"
    );
    expect(patch.status).toBe("added");
    expect(patch.additions).toBe(1);
    expect(patch.deletions).toBe(0);
  });

  it("uses the old path for a renamed file", async () => {
    const base = seedBase();
    const feature = seedFeature(base.hash);
    const patch = await getFilePatch(
      storage,
      project,
      base.hash,
      feature.hash,
      "docs/new.md",
      "docs/old.md"
    );
    expect(patch.status).toBe("renamed");
    expect(patch.oldPath).toBe("docs/old.md");
    expect(patch.hunks).toHaveLength(0);
  });

  it("flags binary files instead of decoding them", async () => {
    const base = storage.seedCommit(repoName, {
      branch: "bin",
      message: "Binary base",
      files: { "data.bin": "abc" },
    });
    const next = storage.seedCommit(repoName, {
      branch: "bin",
      message: "Binary change",
      files: { "data.bin": "abc\u0000def" },
    });
    const patch = await getFilePatch(
      storage,
      project,
      base.hash,
      next.hash,
      "data.bin"
    );
    expect(patch.binary).toBe(true);
    expect(patch.hunks).toHaveLength(0);
  });

  it("marks files over the inline limit as too large", async () => {
    const base = storage.seedCommit(repoName, {
      branch: "large",
      message: "Small",
      files: { "big.txt": "a" },
    });
    const next = storage.seedCommit(repoName, {
      branch: "large",
      message: "Large",
      files: { "big.txt": "a".repeat(1_048_577) },
    });
    const patch = await getFilePatch(
      storage,
      project,
      base.hash,
      next.hash,
      "big.txt"
    );
    expect(patch.tooLarge).toBe(true);
    expect(patch.binary).toBe(false);
    expect(patch.hunks).toHaveLength(0);
  });
});
