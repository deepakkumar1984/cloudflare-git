export interface ArtifactsRepoInfo {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  lastPushAt: string | null;
  source: string | null;
  readOnly: boolean;
  remote: string;
}

export interface ArtifactsCommit {
  hash: string;
  treeHash: string;
  message: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  parents: string[];
  authoredAt: number;
  committedAt: number;
}

export type ArtifactsTreeEntryType =
  | "tree"
  | "blob"
  | "symlink"
  | "gitlink"
  | "exec";

export interface ArtifactsTreeEntry {
  name: string;
  mode: string;
  hash: string;
  type: ArtifactsTreeEntryType;
}

export interface CreatedRepository {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  remote: string;
  token: string;
}

export interface ArtifactsToken {
  id: string;
  plaintext: string;
  scope: "read" | "write";
  expiresAt: string;
}

export interface ArtifactsTokenInfo {
  id: string;
  scope: "read" | "write";
  state: "active" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
}

export interface ArtifactsRepoLike {
  info(): Promise<ArtifactsRepoInfo>;
  createToken(scope?: "read" | "write", ttl?: number): Promise<ArtifactsToken>;
  listTokens(): Promise<{ tokens: ArtifactsTokenInfo[]; total: number }>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  readCommit(hash: string): Promise<ArtifactsCommit | null>;
  readTree(hash: string): Promise<ArtifactsTreeEntry[] | null>;
  readBlob(hash: string): Promise<Blob | null>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
  log(opts?: {
    ref?: string;
    limit?: number;
    offset?: number;
  }): Promise<ArtifactsCommit[]>;
}

export interface ServerRef {
  ref: string;
  oid: string;
}

export interface ImportRepositoryInput {
  source: {
    url: string;
    branch?: string;
    depth?: number;
  };
  target: {
    description?: string;
  };
}

export interface GitStorage {
  createRepository(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      setDefaultBranch?: string;
    }
  ): Promise<CreatedRepository>;
  importRepository(
    name: string,
    input: ImportRepositoryInput
  ): Promise<CreatedRepository>;
  getRepositoryInfo(name: string): Promise<ArtifactsRepoInfo>;
  deleteRepository(name: string): Promise<boolean>;
  withRepository<T>(
    name: string,
    fn: (repo: ArtifactsRepoLike) => Promise<T>
  ): Promise<T>;
  createToken(
    name: string,
    scope: "read" | "write",
    ttlSeconds: number
  ): Promise<ArtifactsToken>;
  revokeToken(name: string, tokenOrId: string): Promise<boolean>;
  listTokens(name: string): Promise<ArtifactsTokenInfo[]>;
  readCommit(name: string, sha: string): Promise<ArtifactsCommit | null>;
  readTree(name: string, hash: string): Promise<ArtifactsTreeEntry[] | null>;
  readBlob(name: string, hash: string): Promise<Blob | null>;
  readFile(name: string, ref: string, path: string): Promise<Blob | null>;
  log(
    name: string,
    opts?: { ref?: string; limit?: number; offset?: number }
  ): Promise<ArtifactsCommit[]>;
  listRefs(name: string): Promise<ServerRef[]>;
}

export function isArtifactsErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export function stripTokenExpiry(token: string): string {
  return token.split("?expires=")[0] ?? token;
}
