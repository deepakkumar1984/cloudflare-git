import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@db/client";
import { gitCommits, gitRefs, projects, type Project } from "@db/schema";
import {
  MAX_INLINE_FILE_BYTES,
  MAX_LOG_COMMITS,
  MAX_PATH_SEGMENTS,
  MAX_TREE_ENTRIES,
  SYNC_LEASE_SECONDS,
} from "@shared/constants";
import type {
  ArtifactsCommit,
  ArtifactsTreeEntry,
  GitStorage,
} from "@worker/artifacts";
import { conflict, notFound, tooLarge } from "@worker/lib/errors";
import {
  detectMergesForTargetPush,
  updateOpenMrsForSourcePush,
} from "./merge-detection";
import { acquireSyncLease, releaseSyncLease } from "./sync-lease";

export interface CommitMetadataInput {
  hash: string;
  treeHash?: string;
  message: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  parents: string[];
  authoredAt: Date;
  committedAt: Date;
}

export interface CommitView {
  hash: string;
  message: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  parents: string[];
  authoredAt: string;
  committedAt: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;

export function toCommitInput(commit: ArtifactsCommit): CommitMetadataInput {
  return {
    hash: commit.hash,
    treeHash: commit.treeHash,
    message: commit.message,
    author: commit.author,
    committer: commit.committer,
    parents: commit.parents,
    authoredAt: new Date(commit.authoredAt * 1_000),
    committedAt: new Date(commit.committedAt * 1_000),
  };
}

export function commitView(commit: CommitMetadataInput): CommitView {
  return {
    hash: commit.hash,
    message: commit.message,
    author: commit.author,
    committer: commit.committer,
    parents: commit.parents,
    authoredAt: commit.authoredAt.toISOString(),
    committedAt: commit.committedAt.toISOString(),
  };
}

export async function upsertCommits(
  db: Database,
  projectId: string,
  commits: CommitMetadataInput[]
): Promise<void> {
  if (commits.length === 0) return;
  await db
    .insert(gitCommits)
    .values(
      commits.map((commit) => ({
        projectId,
        sha: commit.hash,
        treeSha: commit.treeHash ?? "",
        message: commit.message,
        authorName: commit.author.name,
        authorEmail: commit.author.email,
        committerName: commit.committer.name,
        committerEmail: commit.committer.email,
        authoredAt: commit.authoredAt,
        committedAt: commit.committedAt,
        parents: commit.parents,
      }))
    )
    .onConflictDoUpdate({
      target: [gitCommits.projectId, gitCommits.sha],
      set: {
        treeSha: sql`coalesce(nullif(excluded.tree_sha, ''), ${gitCommits.treeSha})`,
        message: sql`excluded.message`,
        authorName: sql`excluded.author_name`,
        authorEmail: sql`excluded.author_email`,
        committerName: sql`excluded.committer_name`,
        committerEmail: sql`excluded.committer_email`,
        authoredAt: sql`excluded.authored_at`,
        committedAt: sql`excluded.committed_at`,
        parents: sql`excluded.parents`,
      },
    });
}

export function validateRef(ref: string): string {
  const value = ref.trim();
  if (
    !value ||
    value.length > 255 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    value.includes("\\") ||
    // oxlint-disable-next-line no-control-regex -- control characters are rejected on purpose
    /[\u0000-\u001f\u007f]/.test(value) ||
    /[\s~^:?*[\]\\]/.test(value)
  ) {
    throw notFound("Invalid ref");
  }
  return value;
}

export function validatePath(path: string): string {
  const value = path.trim().replace(/^\/+|\/+$/g, "");
  if (!value) return "";
  if (
    value.length > 4_096 ||
    value.includes("\u0000") ||
    value.includes("\\") ||
    value.split("/").length > MAX_PATH_SEGMENTS ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw notFound("Invalid path");
  }
  return value;
}

export async function resolveRefSha(
  db: Database,
  project: Project,
  ref?: string
): Promise<string | null> {
  const value = validateRef(ref || project.defaultBranch);
  if (SHA_RE.test(value)) return value;
  const candidates = [value, `refs/heads/${value}`, `refs/tags/${value}`];
  const [row] = await db
    .select({ sha: gitRefs.sha })
    .from(gitRefs)
    .where(
      and(
        eq(gitRefs.projectId, project.id),
        inArray(gitRefs.refName, candidates),
        isNull(gitRefs.deletedAt)
      )
    )
    .limit(1);
  return row?.sha ?? null;
}

export async function getTree(
  db: Database,
  storage: GitStorage,
  project: Project,
  ref: string,
  path: string
) {
  const sha = await resolveRefSha(db, project, ref);
  if (!sha) throw notFound("Ref not found");
  const cleanPath = validatePath(path);

  return storage.withRepository(project.artifactsRepoName, async (repo) => {
    const commit = await repo.readCommit(sha);
    if (!commit) throw notFound("Commit not found");
    let treeHash = commit.treeHash;
    let currentEntry: ArtifactsTreeEntry | null = null;

    if (cleanPath) {
      const parts = cleanPath.split("/");
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index]!;
        const entries = await repo.readTree(treeHash);
        if (!entries) throw notFound("Path not found");
        const entry = entries.find((candidate) => candidate.name === part);
        if (!entry) throw notFound("Path not found");
        if (index === parts.length - 1) {
          currentEntry = entry;
          if (entry.type !== "tree") throw notFound("Not a directory");
        } else {
          if (entry.type !== "tree") throw notFound("Path not found");
        }
        treeHash = entry.hash;
      }
    }

    const entries = await repo.readTree(treeHash);
    if (!entries) throw notFound("Tree not found");
    const sorted = [...entries].sort((a, b) => {
      if (a.type === "tree" && b.type !== "tree") return -1;
      if (a.type !== "tree" && b.type === "tree") return 1;
      return a.name.localeCompare(b.name);
    });
    const visible = sorted.slice(0, MAX_TREE_ENTRIES);

    return {
      ref,
      sha,
      path: cleanPath,
      truncated: sorted.length > MAX_TREE_ENTRIES,
      entries: visible.map((entry) => ({
        name: entry.name,
        path: cleanPath ? `${cleanPath}/${entry.name}` : entry.name,
        type: entry.type === "tree" ? "tree" : "file",
        mode: entry.mode,
        hash: entry.hash,
      })),
      commit: {
        hash: commit.hash,
        message: commit.message,
        authoredAt: new Date(commit.authoredAt * 1_000).toISOString(),
        author: commit.author,
      },
      entry: currentEntry,
    };
  });
}

const MIME_BY_EXTENSION: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  toml: "text/plain; charset=utf-8",
  ts: "text/typescript; charset=utf-8",
  tsx: "text/typescript; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  jsx: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function mimeForPath(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("yaml")
  );
}

export async function getBlob(
  db: Database,
  storage: GitStorage,
  project: Project,
  ref: string,
  path: string
) {
  const cleanPath = validatePath(path);
  if (!cleanPath) throw notFound("File not found");
  const sha = await resolveRefSha(db, project, ref);
  if (!sha) throw notFound("Ref not found");

  return storage.withRepository(project.artifactsRepoName, async (repo) => {
    const commit = await repo.readCommit(sha);
    if (!commit) throw notFound("Commit not found");
    const parts = cleanPath.split("/");
    let treeHash = commit.treeHash;
    let blobHash: string | null = null;
    let mode = "";

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const entries = await repo.readTree(treeHash);
      if (!entries) throw notFound("Path not found");
      const entry = entries.find((candidate) => candidate.name === part);
      if (!entry) throw notFound("Path not found");
      if (index === parts.length - 1) {
        if (entry.type === "tree" || entry.type === "gitlink") {
          throw notFound("Not a file");
        }
        blobHash = entry.hash;
        mode = entry.mode;
      } else {
        if (entry.type !== "tree") throw notFound("Path not found");
        treeHash = entry.hash;
      }
    }

    if (!blobHash) throw notFound("File not found");
    const blob = await repo.readBlob(blobHash);
    if (!blob) throw notFound("File not found");
    if (blob.size > MAX_INLINE_FILE_BYTES) {
      throw tooLarge("File is too large to display inline");
    }
    const mime = mimeForPath(cleanPath);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const binary =
      !isTextMime(mime) ||
      bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0);
    return {
      ref,
      sha,
      commit: commit.hash,
      path: cleanPath,
      hash: blobHash,
      mode,
      size: blob.size,
      mime,
      binary,
      text: binary ? null : new TextDecoder().decode(bytes),
    };
  });
}

export async function getRawFile(
  db: Database,
  storage: GitStorage,
  project: Project,
  ref: string,
  path: string
) {
  const cleanPath = validatePath(path);
  if (!cleanPath) throw notFound("File not found");
  const sha = await resolveRefSha(db, project, ref);
  if (!sha) throw notFound("Ref not found");
  const blob = await storage.readFile(
    project.artifactsRepoName,
    sha,
    cleanPath
  );
  if (!blob) throw notFound("File not found");
  return {
    blob,
    filename: cleanPath.split("/").at(-1) || "download",
    size: blob.size,
    mime: mimeForPath(cleanPath),
  };
}

export async function getCommits(
  db: Database,
  storage: GitStorage,
  project: Project,
  ref: string,
  limit: number,
  offset: number
) {
  const value = validateRef(ref || project.defaultBranch);
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeOffset = Math.max(0, Math.min(offset, 100_000));
  const commits = await storage.log(project.artifactsRepoName, {
    ref: value,
    limit: Math.min(MAX_LOG_COMMITS, safeLimit + 1),
    offset: safeOffset,
  });
  const hasMore = commits.length > safeLimit;
  const inputs = commits.slice(0, safeLimit).map(toCommitInput);
  await upsertCommits(db, project.id, inputs);
  return {
    ref: value,
    commits: inputs.map(commitView),
    hasMore,
  };
}

export async function getCommitDetail(
  db: Database,
  storage: GitStorage,
  project: Project,
  ref: string
) {
  const sha = SHA_RE.test(ref) ? ref : await resolveRefSha(db, project, ref);
  if (!sha) throw notFound("Commit not found");
  const commit = await storage.readCommit(project.artifactsRepoName, sha);
  if (!commit) throw notFound("Commit not found");
  const input = toCommitInput(commit);
  await upsertCommits(db, project.id, [input]);
  return {
    commit: commitView(input),
    ref,
  };
}

export async function getBranches(db: Database, project: Project) {
  const refs = await db
    .select()
    .from(gitRefs)
    .where(
      and(
        eq(gitRefs.projectId, project.id),
        eq(gitRefs.refType, "branch"),
        isNull(gitRefs.deletedAt)
      )
    );
  if (refs.length === 0) return [];
  const commits = await db
    .select()
    .from(gitCommits)
    .where(
      and(
        eq(gitCommits.projectId, project.id),
        inArray(
          gitCommits.sha,
          refs.map((ref) => ref.sha)
        )
      )
    );
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  return refs
    .map((ref) => {
      const commit = bySha.get(ref.sha);
      return {
        name: ref.refName.replace(/^refs\/heads\//, ""),
        sha: ref.sha,
        updatedAt: ref.updatedAt.toISOString(),
        commit: commit
          ? {
              hash: commit.sha,
              message: commit.message,
              author: { name: commit.authorName, email: commit.authorEmail },
              committedAt: commit.committedAt.toISOString(),
            }
          : null,
      };
    })
    .sort((a, b) => {
      if (a.name === project.defaultBranch) return -1;
      if (b.name === project.defaultBranch) return 1;
      return a.name.localeCompare(b.name);
    });
}

export async function getReadme(
  storage: GitStorage,
  project: Project
): Promise<{ path: string; content: string } | null> {
  for (const name of ["README.md", "readme.md", "README", "README.txt"]) {
    const blob = await storage.readFile(
      project.artifactsRepoName,
      project.defaultBranch,
      name
    );
    if (!blob) continue;
    if (blob.size > 512 * 1_024) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0)) continue;
    return { path: name, content: new TextDecoder().decode(bytes) };
  }
  return null;
}

/**
 * Manual/lazy reconciliation. List refs over the Git protocol, cache commits,
 * and detect merges for changed target branches.
 */
export async function refreshRepositoryRefs(
  db: Database,
  storage: GitStorage,
  project: Project
): Promise<{ branches: number; tags: number; changed: number }> {
  if (project.provisioningState !== "ready") {
    throw conflict("Repository is not ready");
  }
  const holder = crypto.randomUUID();
  const acquired = await acquireSyncLease(
    db,
    project.id,
    holder,
    SYNC_LEASE_SECONDS
  );
  if (!acquired) throw conflict("A repository sync is already running");

  try {
    const previous = await db
      .select()
      .from(gitRefs)
      .where(eq(gitRefs.projectId, project.id));
    const previousByRef = new Map(previous.map((ref) => [ref.refName, ref]));
    const refs = await storage.listRefs(project.artifactsRepoName);
    const seen = new Set<string>();
    let branches = 0;
    let tags = 0;
    let changed = 0;
    let defaultBranch = project.defaultBranch;
    const hadBranches = previous.some(
      (ref) => ref.refType === "branch" && !ref.deletedAt
    );
    const branchNames = refs
      .filter((ref) => ref.ref.startsWith("refs/heads/"))
      .map((ref) => ref.ref.replace(/^refs\/heads\//, ""));
    if (!hadBranches && branchNames.length > 0) {
      defaultBranch = branchNames.includes(project.defaultBranch)
        ? project.defaultBranch
        : branchNames[0]!;
    }

    for (const ref of refs) {
      const isBranch = ref.ref.startsWith("refs/heads/");
      const isTag = ref.ref.startsWith("refs/tags/");
      if (!isBranch && !isTag) continue;
      seen.add(ref.ref);
      if (isBranch) branches += 1;
      if (isTag) tags += 1;
      const old = previousByRef.get(ref.ref);
      if (!old || old.sha !== ref.oid) changed += 1;

      await db
        .insert(gitRefs)
        .values({
          projectId: project.id,
          refName: ref.ref,
          refType: isBranch ? "branch" : "tag",
          sha: ref.oid,
          deletedAt: null,
          lastEventAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [gitRefs.projectId, gitRefs.refName],
          set: {
            sha: ref.oid,
            deletedAt: null,
            lastEventAt: new Date(),
            updatedAt: new Date(),
          },
        });

      if (isBranch && (!old || old.sha !== ref.oid)) {
        const branchName = ref.ref.replace(/^refs\/heads\//, "");
        const commits = await storage.log(project.artifactsRepoName, {
          ref: branchName,
          limit: 50,
        });
        const inputs = commits.map(toCommitInput);
        await upsertCommits(db, project.id, inputs);
        await updateOpenMrsForSourcePush(db, project.id, branchName, ref.oid);
        if (old?.sha) {
          await detectMergesForTargetPush(
            db,
            storage,
            project,
            branchName,
            old.sha,
            ref.oid,
            inputs.map((commit) => ({
              hash: commit.hash,
              message: commit.message,
              parents: commit.parents,
            }))
          );
        }
      }
    }

    for (const old of previous) {
      if (!seen.has(old.refName) && !old.deletedAt) {
        await db
          .update(gitRefs)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(gitRefs.id, old.id));
      }
    }

    const nextDefault =
      branches > 0 && !hadBranches ? defaultBranch : project.defaultBranch;
    await db
      .update(projects)
      .set({
        defaultBranch: nextDefault,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    return { branches, tags, changed };
  } finally {
    await releaseSyncLease(db, project.id, holder);
  }
}
