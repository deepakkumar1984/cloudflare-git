import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import {
  type ArtifactsCommit,
  type ArtifactsRepoInfo,
  type ArtifactsRepoLike,
  type ArtifactsToken,
  type ArtifactsTokenInfo,
  type ArtifactsTreeEntry,
  type CreatedRepository,
  type GitStorage,
  type ImportRepositoryInput,
  type ServerRef,
  stripTokenExpiry,
} from "./types";

type DisposableRepo = ArtifactsRepo & { [Symbol.dispose]?: () => void };

export class WorkerGitStorage implements GitStorage {
  constructor(private readonly binding: Artifacts) {}

  async createRepository(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      setDefaultBranch?: string;
    }
  ): Promise<CreatedRepository> {
    const created = await this.binding.create(name, opts);
    return {
      id: created.id,
      name: created.name,
      description: created.description,
      defaultBranch: created.defaultBranch,
      remote: created.remote,
      token: created.token,
    };
  }

  async importRepository(
    name: string,
    input: ImportRepositoryInput
  ): Promise<CreatedRepository> {
    const created = await this.binding.import({
      source: input.source,
      target: {
        name,
        opts: { description: input.target.description },
      },
    });
    return {
      id: created.id,
      name: created.name,
      description: created.description,
      defaultBranch: created.defaultBranch,
      remote: created.remote,
      token: created.token,
    };
  }

  async getRepositoryInfo(name: string): Promise<ArtifactsRepoInfo> {
    return this.withRepository(name, (repo) => repo.info());
  }

  async deleteRepository(name: string): Promise<boolean> {
    return this.binding.delete(name);
  }

  async withRepository<T>(
    name: string,
    fn: (repo: ArtifactsRepoLike) => Promise<T>
  ): Promise<T> {
    const repo = (await this.binding.get(name)) as DisposableRepo;
    try {
      return await fn(repo);
    } finally {
      try {
        repo[Symbol.dispose]?.();
      } catch {
        // The service may already have released the capability.
      }
    }
  }

  async createToken(
    name: string,
    scope: "read" | "write",
    ttlSeconds: number
  ): Promise<ArtifactsToken> {
    return this.withRepository(name, async (repo) => {
      const token = await repo.createToken(scope, ttlSeconds);
      return {
        id: token.id,
        plaintext: token.plaintext,
        scope: token.scope,
        expiresAt: token.expiresAt,
      };
    });
  }

  async revokeToken(name: string, tokenOrId: string): Promise<boolean> {
    return this.withRepository(name, (repo) => repo.revokeToken(tokenOrId));
  }

  async listTokens(name: string): Promise<ArtifactsTokenInfo[]> {
    return this.withRepository(name, async (repo) => {
      const result = await repo.listTokens();
      return result.tokens;
    });
  }

  async readCommit(name: string, sha: string): Promise<ArtifactsCommit | null> {
    return this.withRepository(name, (repo) => repo.readCommit(sha));
  }

  async readTree(
    name: string,
    hash: string
  ): Promise<ArtifactsTreeEntry[] | null> {
    return this.withRepository(name, (repo) => repo.readTree(hash));
  }

  async readBlob(name: string, hash: string): Promise<Blob | null> {
    return this.withRepository(name, (repo) => repo.readBlob(hash));
  }

  async readFile(
    name: string,
    ref: string,
    path: string
  ): Promise<Blob | null> {
    return this.withRepository(name, (repo) => repo.readFile({ ref, path }));
  }

  async log(
    name: string,
    opts?: { ref?: string; limit?: number; offset?: number }
  ): Promise<ArtifactsCommit[]> {
    return this.withRepository(name, (repo) => repo.log(opts));
  }

  async listRefs(name: string): Promise<ServerRef[]> {
    const info = await this.getRepositoryInfo(name);
    const token = await this.createToken(name, "read", 60);
    try {
      const refs = await git.listServerRefs({
        http,
        url: info.remote,
        onAuth: () => ({
          username: "x",
          password: stripTokenExpiry(token.plaintext),
        }),
      });
      return refs
        .filter(
          (ref) =>
            ref.ref.startsWith("refs/heads/") ||
            ref.ref.startsWith("refs/tags/")
        )
        .map((ref) => ({ ref: ref.ref, oid: ref.oid }));
    } finally {
      await this.revokeToken(name, token.id).catch(() => false);
    }
  }
}
