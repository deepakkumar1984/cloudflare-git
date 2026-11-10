import { structuredPatch } from "diff";
import type { Project } from "@db/schema";
import {
  MAX_DIFF_DEPTH,
  MAX_DIFF_FILES,
  MAX_DIFF_PATCH_BYTES,
  MAX_DIFF_TREE_ENTRIES,
} from "@shared/constants";
import type {
  ArtifactsRepoLike,
  ArtifactsTreeEntry,
  GitStorage,
} from "@worker/artifacts";
import { notFound, tooLarge } from "@worker/lib/errors";

const MAX_BLOB_BYTES = 1_048_576;
const MAX_MERGE_BASE_WALK = 250;

interface FlatEntry {
  hash: string;
  mode: string;
  type: ArtifactsTreeEntry["type"];
}

interface FlatTree {
  entries: Map<string, FlatEntry>;
  truncated: boolean;
}

async function flattenTree(
  repo: ArtifactsRepoLike,
  rootHash: string
): Promise<FlatTree> {
  const entries = new Map<string, FlatEntry>();
  let truncated = false;
  let visited = 0;

  async function walk(treeHash: string, prefix: string, depth: number) {
    if (depth > MAX_DIFF_DEPTH || visited > MAX_DIFF_TREE_ENTRIES) {
      truncated = true;
      return;
    }
    const children = await repo.readTree(treeHash);
    if (!children) return;
    for (const child of children) {
      visited += 1;
      if (visited > MAX_DIFF_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.type === "tree") {
        await walk(child.hash, path, depth + 1);
      } else if (child.type !== "gitlink") {
        entries.set(path, {
          hash: child.hash,
          mode: child.mode,
          type: child.type,
        });
      }
    }
  }

  await walk(rootHash, "", 0);
  return { entries, truncated };
}

async function readCommitTree(
  repo: ArtifactsRepoLike,
  sha: string
): Promise<{ treeHash: string; parents: string[] }> {
  const commit = await repo.readCommit(sha);
  if (!commit) throw notFound("Commit not found");
  return { treeHash: commit.treeHash, parents: commit.parents };
}

async function ancestorDepths(
  repo: ArtifactsRepoLike,
  head: string
): Promise<Map<string, number>> {
  const depths = new Map<string, number>();
  const queue: Array<{ sha: string; depth: number }> = [
    { sha: head, depth: 0 },
  ];
  while (queue.length > 0 && depths.size < MAX_MERGE_BASE_WALK) {
    const current = queue.shift()!;
    if (depths.has(current.sha)) continue;
    depths.set(current.sha, current.depth);
    const commit = await repo.readCommit(current.sha);
    if (!commit) continue;
    for (const parent of commit.parents) {
      if (!depths.has(parent)) {
        queue.push({ sha: parent, depth: current.depth + 1 });
      }
    }
  }
  return depths;
}

export async function findMergeBase(
  storage: GitStorage,
  project: Project,
  sourceSha: string,
  targetSha: string
): Promise<{ sha: string; found: boolean }> {
  if (sourceSha === targetSha) return { sha: targetSha, found: true };
  return storage.withRepository(project.artifactsRepoName, async (repo) => {
    const [sourceDepths, targetDepths] = await Promise.all([
      ancestorDepths(repo, sourceSha),
      ancestorDepths(repo, targetSha),
    ]);
    let best: { sha: string; depth: number } | null = null;
    for (const [sha, depth] of targetDepths) {
      const sourceDepth = sourceDepths.get(sha);
      if (sourceDepth === undefined) continue;
      const score = Math.max(sourceDepth, depth);
      if (!best || score < best.depth) best = { sha, depth: score };
    }
    return best
      ? { sha: best.sha, found: true }
      : { sha: targetSha, found: false };
  });
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  hash: string;
  oldHash: string | null;
}

export async function listChangedFiles(
  storage: GitStorage,
  project: Project,
  baseSha: string,
  headSha: string
): Promise<{ files: DiffFile[]; truncated: boolean }> {
  if (baseSha === headSha) return { files: [], truncated: false };
  return storage.withRepository(project.artifactsRepoName, async (repo) => {
    const base = await readCommitTree(repo, baseSha);
    const head = await readCommitTree(repo, headSha);
    const [baseFlat, headFlat] = await Promise.all([
      flattenTree(repo, base.treeHash),
      flattenTree(repo, head.treeHash),
    ]);

    const files: DiffFile[] = [];
    const deleted = new Map<string, FlatEntry>();
    for (const [path, entry] of baseFlat.entries) {
      const next = headFlat.entries.get(path);
      if (!next) {
        deleted.set(path, entry);
      } else if (next.hash !== entry.hash) {
        files.push({
          path,
          oldPath: path,
          status: "modified",
          hash: next.hash,
          oldHash: entry.hash,
        });
      }
    }

    const deletedByHash = new Map<string, string>();
    for (const [path, entry] of deleted) {
      if (!deletedByHash.has(entry.hash)) deletedByHash.set(entry.hash, path);
    }

    for (const [path, entry] of headFlat.entries) {
      if (baseFlat.entries.has(path)) continue;
      const oldPath = deletedByHash.get(entry.hash);
      if (oldPath) {
        files.push({
          path,
          oldPath,
          status: "renamed",
          hash: entry.hash,
          oldHash: entry.hash,
        });
        deleted.delete(oldPath);
        deletedByHash.delete(entry.hash);
      } else {
        files.push({
          path,
          oldPath: null,
          status: "added",
          hash: entry.hash,
          oldHash: null,
        });
      }
    }

    for (const [path, entry] of deleted) {
      files.push({
        path,
        oldPath: path,
        status: "deleted",
        hash: entry.hash,
        oldHash: entry.hash,
      });
    }

    const sorted = files
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, MAX_DIFF_FILES);
    return {
      files: sorted,
      truncated:
        baseFlat.truncated ||
        headFlat.truncated ||
        files.length > MAX_DIFF_FILES,
    };
  });
}

async function findEntry(
  repo: ArtifactsRepoLike,
  treeHash: string,
  path: string
): Promise<FlatEntry | null> {
  const parts = path.split("/").filter(Boolean);
  let currentTree = treeHash;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const entries = await repo.readTree(currentTree);
    if (!entries) return null;
    const entry = entries.find((candidate) => candidate.name === part);
    if (!entry) return null;
    if (index === parts.length - 1) {
      return entry.type === "tree" || entry.type === "gitlink"
        ? null
        : { hash: entry.hash, mode: entry.mode, type: entry.type };
    }
    if (entry.type !== "tree") return null;
    currentTree = entry.hash;
  }
  return null;
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0);
}

export interface FilePatch {
  path: string;
  oldPath: string | null;
  status: "added" | "modified" | "deleted" | "renamed";
  binary: boolean;
  tooLarge: boolean;
  additions: number;
  deletions: number;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
}

export async function getFilePatch(
  storage: GitStorage,
  project: Project,
  baseSha: string,
  headSha: string,
  path: string,
  oldPath?: string
): Promise<FilePatch> {
  return storage.withRepository(project.artifactsRepoName, async (repo) => {
    const base = await readCommitTree(repo, baseSha);
    const head = await readCommitTree(repo, headSha);
    const oldEntry = await findEntry(repo, base.treeHash, oldPath ?? path);
    const newEntry = await findEntry(repo, head.treeHash, path);

    const status: FilePatch["status"] = !oldEntry
      ? "added"
      : !newEntry
        ? "deleted"
        : oldPath && oldPath !== path
          ? "renamed"
          : "modified";

    let oldText = "";
    let newText = "";
    let binary = false;

    if (oldEntry) {
      const blob = await repo.readBlob(oldEntry.hash);
      if (!blob) throw notFound("Old file not found");
      if (blob.size > MAX_BLOB_BYTES) {
        return {
          path,
          oldPath: oldPath ?? path,
          status,
          binary: false,
          tooLarge: true,
          additions: 0,
          deletions: 0,
          hunks: [],
        };
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      binary ||= isBinary(bytes);
      oldText = new TextDecoder().decode(bytes);
    }

    if (newEntry) {
      const blob = await repo.readBlob(newEntry.hash);
      if (!blob) throw notFound("New file not found");
      if (blob.size > MAX_BLOB_BYTES) {
        return {
          path,
          oldPath: oldPath ?? path,
          status,
          binary: false,
          tooLarge: true,
          additions: 0,
          deletions: 0,
          hunks: [],
        };
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      binary ||= isBinary(bytes);
      newText = new TextDecoder().decode(bytes);
    }

    if (binary) {
      return {
        path,
        oldPath: oldPath ?? path,
        status,
        binary: true,
        tooLarge: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      };
    }

    const patch = structuredPatch(
      oldPath ?? path,
      path,
      oldText,
      newText,
      "",
      "",
      { context: 3 }
    );
    const hunks = patch.hunks.map((hunk) => ({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.lines,
    }));
    let additions = 0;
    let deletions = 0;
    let size = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        size += line.length + 1;
        if (line.startsWith("+")) additions += 1;
        if (line.startsWith("-")) deletions += 1;
      }
    }
    if (size > MAX_DIFF_PATCH_BYTES) {
      throw tooLarge("Patch is too large to display");
    }

    return {
      path,
      oldPath: oldPath ?? path,
      status,
      binary: false,
      tooLarge: false,
      additions,
      deletions,
      hunks,
    };
  });
}
