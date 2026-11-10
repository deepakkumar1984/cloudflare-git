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
} from "./types";

function hashText(value: string, seed = 0): string {
  let a = 0x811c9dc5 ^ seed;
  let b = 0x9e3779b9 ^ (seed << 1);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return [
    a,
    b,
    Math.imul(a ^ b, 0xc2b2ae35) >>> 0,
    (a ^ 0x27d4eb2f) >>> 0,
    (b ^ 0x165667b1) >>> 0,
  ]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("")
    .slice(0, 40);
}

function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

class FakeRepo implements ArtifactsRepoLike {
  infoValue: ArtifactsRepoInfo;
  refs = new Map<string, string>();
  commits = new Map<string, ArtifactsCommit>();
  trees = new Map<string, ArtifactsTreeEntry[]>();
  blobs = new Map<string, Blob>();
  tokens = new Map<
    string,
    ArtifactsToken & { state: ArtifactsTokenInfo["state"] }
  >();

  constructor(
    readonly storage: FakeGitStorage,
    readonly name: string,
    description: string | null,
    defaultBranch: string,
    readonly token: string
  ) {
    const timestamp = new Date().toISOString();
    this.infoValue = {
      id: `fake-${hashText(name)}`,
      name,
      description,
      defaultBranch,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastPushAt: null,
      source: null,
      readOnly: false,
      remote: `https://fake-artifacts.local/git/${storage.namespace}/${name}.git`,
    };
  }

  async info(): Promise<ArtifactsRepoInfo> {
    return { ...this.infoValue };
  }

  async createToken(
    scope: "read" | "write" = "write",
    ttl = 86_400
  ): Promise<ArtifactsToken> {
    const tokenId = `tok_${hashText(`${this.name}:${Date.now()}:${Math.random()}`)}`;
    const expiresAt = toIso(Math.floor(Date.now() / 1000) + Math.max(60, ttl));
    const plaintext = `art_v1_${hashText(`${tokenId}:${Math.random()}`)}?expires=${Math.floor(
      new Date(expiresAt).getTime() / 1000
    )}`;
    const token: ArtifactsToken = {
      id: tokenId,
      plaintext,
      scope,
      expiresAt,
    };
    this.tokens.set(tokenId, { ...token, state: "active" });
    return token;
  }

  async listTokens(): Promise<{
    tokens: ArtifactsTokenInfo[];
    total: number;
  }> {
    const now = Date.now();
    const tokens = [...this.tokens.values()].map((token) => ({
      id: token.id,
      scope: token.scope,
      state:
        token.state === "revoked"
          ? ("revoked" as const)
          : new Date(token.expiresAt).getTime() < now
            ? ("expired" as const)
            : ("active" as const),
      createdAt: new Date(
        Math.min(now, new Date(token.expiresAt).getTime() - 60_000)
      ).toISOString(),
      expiresAt: token.expiresAt,
    }));
    return { tokens, total: tokens.length };
  }

  async revokeToken(tokenOrId: string): Promise<boolean> {
    let id = tokenOrId;
    if (tokenOrId.startsWith("art_v1_")) {
      const found = [...this.tokens.values()].find(
        (token) => token.plaintext === tokenOrId
      );
      if (!found) return false;
      id = found.id;
    }
    const token = this.tokens.get(id);
    if (!token) return false;
    token.state = "revoked";
    return true;
  }

  async readCommit(hash: string): Promise<ArtifactsCommit | null> {
    return this.commits.get(hash) ?? null;
  }

  async readTree(hash: string): Promise<ArtifactsTreeEntry[] | null> {
    return this.trees.get(hash) ?? null;
  }

  async readBlob(hash: string): Promise<Blob | null> {
    return this.blobs.get(hash) ?? null;
  }

  async readFile(args: { ref: string; path: string }): Promise<Blob | null> {
    const sha = this.resolveRef(args.ref);
    if (!sha) return null;
    const commit = this.commits.get(sha);
    if (!commit) return null;
    const parts = args.path.split("/").filter(Boolean);
    let treeHash = commit.treeHash;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const entries = this.trees.get(treeHash);
      const entry = entries?.find((candidate) => candidate.name === part);
      if (!entry) return null;
      if (i === parts.length - 1) {
        if (entry.type === "tree" || entry.type === "gitlink") return null;
        return this.blobs.get(entry.hash) ?? null;
      }
      if (entry.type !== "tree") return null;
      treeHash = entry.hash;
    }
    return null;
  }

  async log(opts?: {
    ref?: string;
    limit?: number;
    offset?: number;
  }): Promise<ArtifactsCommit[]> {
    const start = this.resolveRef(opts?.ref ?? "HEAD");
    if (!start) return [];
    const limit = Math.max(1, Math.min(opts?.limit ?? 50, 1_000));
    const offset = Math.max(0, opts?.offset ?? 0);
    const result: ArtifactsCommit[] = [];
    let current: string | undefined = start;
    let index = 0;
    while (current && result.length < limit + offset) {
      const commit: ArtifactsCommit | undefined = this.commits.get(current);
      if (!commit) break;
      if (index >= offset) result.push(commit);
      current = commit.parents[0];
      index += 1;
    }
    return result.slice(0, limit);
  }

  resolveRef(ref: string): string | undefined {
    if (ref === "HEAD")
      return this.refs.get(`refs/heads/${this.infoValue.defaultBranch}`);
    if (this.commits.has(ref)) return ref;
    return (
      this.refs.get(ref) ??
      this.refs.get(`refs/heads/${ref}`) ??
      this.refs.get(`refs/tags/${ref}`)
    );
  }
}

export class FakeGitStorage implements GitStorage {
  readonly repos = new Map<string, FakeRepo>();

  constructor(readonly namespace = "cloudflare-git") {}

  async createRepository(
    name: string,
    opts?: {
      description?: string;
      readOnly?: boolean;
      setDefaultBranch?: string;
    }
  ): Promise<CreatedRepository> {
    if (this.repos.has(name)) {
      throw Object.assign(new Error("Repository already exists"), {
        code: "ALREADY_EXISTS",
      });
    }
    const token = `art_v1_${hashText(`${name}:${Date.now()}`)}?expires=${
      Math.floor(Date.now() / 1000) + 86_400
    }`;
    const repo = new FakeRepo(
      this,
      name,
      opts?.description ?? null,
      opts?.setDefaultBranch ?? "main",
      token
    );
    this.repos.set(name, repo);
    return {
      id: repo.infoValue.id,
      name,
      description: repo.infoValue.description,
      defaultBranch: repo.infoValue.defaultBranch,
      remote: repo.infoValue.remote,
      token,
    };
  }

  async importRepository(
    name: string,
    input: ImportRepositoryInput
  ): Promise<CreatedRepository> {
    if (this.repos.has(name)) {
      throw Object.assign(new Error("Repository already exists"), {
        code: "ALREADY_EXISTS",
      });
    }
    const branch = input.source.branch ?? "main";
    const created = await this.createRepository(name, {
      description: input.target.description,
      setDefaultBranch: branch,
    });
    const sourceHost = (() => {
      try {
        return new URL(input.source.url).hostname;
      } catch {
        return "a Git provider";
      }
    })();
    this.seedCommit(name, {
      branch,
      message: `Import repository snapshot from ${sourceHost}`,
      timestamp: Math.floor(Date.now() / 1_000),
      files: {
        "README.md": `# ${input.target.description || "Imported repository"}\n\nThis demo repository was imported from ${sourceHost}.\n\n- Browse the tree in the repository tab\n- Push changes with a project credential\n`,
        ".gitignore": "node_modules/\ndist/\n.env\n",
        "src/index.ts": `export function hello(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`,
      },
    });
    return created;
  }

  async getRepositoryInfo(name: string): Promise<ArtifactsRepoInfo> {
    return this.get(name).info();
  }

  async deleteRepository(name: string): Promise<boolean> {
    return this.repos.delete(name);
  }

  async withRepository<T>(
    name: string,
    fn: (repo: ArtifactsRepoLike) => Promise<T>
  ): Promise<T> {
    return fn(this.get(name));
  }

  async createToken(
    name: string,
    scope: "read" | "write",
    ttlSeconds: number
  ): Promise<ArtifactsToken> {
    return this.get(name).createToken(scope, ttlSeconds);
  }

  async revokeToken(name: string, tokenOrId: string): Promise<boolean> {
    return this.get(name).revokeToken(tokenOrId);
  }

  async listTokens(name: string): Promise<ArtifactsTokenInfo[]> {
    return (await this.get(name).listTokens()).tokens;
  }

  async readCommit(name: string, sha: string): Promise<ArtifactsCommit | null> {
    return this.get(name).readCommit(sha);
  }

  async readTree(
    name: string,
    hash: string
  ): Promise<ArtifactsTreeEntry[] | null> {
    return this.get(name).readTree(hash);
  }

  async readBlob(name: string, hash: string): Promise<Blob | null> {
    return this.get(name).readBlob(hash);
  }

  async readFile(
    name: string,
    ref: string,
    path: string
  ): Promise<Blob | null> {
    return this.get(name).readFile({ ref, path });
  }

  async log(
    name: string,
    opts?: { ref?: string; limit?: number; offset?: number }
  ): Promise<ArtifactsCommit[]> {
    return this.get(name).log(opts);
  }

  async listRefs(name: string): Promise<ServerRef[]> {
    return [...this.get(name).refs.entries()].map(([ref, oid]) => ({
      ref,
      oid,
    }));
  }

  /** Test/local helper: creates a commit with a nested file tree. */
  seedCommit(
    name: string,
    options: {
      branch?: string;
      parentSha?: string;
      parentShas?: string[];
      message: string;
      files: Record<string, string>;
      author?: { name: string; email: string };
      timestamp?: number;
    }
  ): ArtifactsCommit {
    const repo = this.get(name);
    const branch = options.branch ?? repo.infoValue.defaultBranch;
    const ref = `refs/heads/${branch}`;
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const author = options.author ?? {
      name: "Cloudflare Git",
      email: "developer@example.com",
    };

    const treeHash = this.buildTree(repo, options.files);
    const parents = options.parentShas
      ? options.parentShas
      : options.parentSha
        ? [options.parentSha]
        : repo.refs.has(ref)
          ? [repo.refs.get(ref)!]
          : [];
    const hash = hashText(
      `${treeHash}:${options.message}:${timestamp}:${parents.join(",")}`
    );
    const commit: ArtifactsCommit = {
      hash,
      treeHash,
      message: options.message,
      author,
      committer: author,
      parents,
      authoredAt: timestamp,
      committedAt: timestamp,
    };
    repo.commits.set(hash, commit);
    repo.refs.set(ref, hash);
    repo.infoValue = {
      ...repo.infoValue,
      defaultBranch: repo.refs.has(`refs/heads/${repo.infoValue.defaultBranch}`)
        ? repo.infoValue.defaultBranch
        : branch,
      lastPushAt: toIso(timestamp),
      updatedAt: toIso(timestamp),
    };
    return commit;
  }

  private buildTree(repo: FakeRepo, files: Record<string, string>): string {
    type Node = { files: Map<string, string>; dirs: Map<string, Node> };
    const root: Node = { files: new Map(), dirs: new Map() };
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split("/").filter(Boolean);
      let node = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i]!;
        if (!node.dirs.has(part)) {
          node.dirs.set(part, { files: new Map(), dirs: new Map() });
        }
        node = node.dirs.get(part)!;
      }
      node.files.set(parts.at(-1)!, content);
    }

    const writeNode = (
      node: Node
    ): { hash: string; entries: ArtifactsTreeEntry[] } => {
      const entries: ArtifactsTreeEntry[] = [];
      for (const [fileName, content] of node.files) {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        // Git blob IDs depend on content only; this keeps fake rename
        // detection honest when the same content moves between paths.
        const blobHash = hashText(content);
        repo.blobs.set(blobHash, blob);
        entries.push({
          name: fileName,
          mode: "100644",
          hash: blobHash,
          type: "blob",
        });
      }
      for (const [dirName, child] of node.dirs) {
        const written = writeNode(child);
        entries.push({
          name: dirName,
          mode: "40000",
          hash: written.hash,
          type: "tree",
        });
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const treeHash = hashText(
        entries
          .map((entry) => `${entry.mode}:${entry.name}:${entry.hash}`)
          .join("\n")
      );
      repo.trees.set(treeHash, entries);
      return { hash: treeHash, entries };
    };

    return writeNode(root).hash;
  }

  private get(name: string): FakeRepo {
    const repo = this.repos.get(name);
    if (!repo) {
      throw Object.assign(new Error(`Repository ${name} not found`), {
        code: "NOT_FOUND",
      });
    }
    return repo;
  }
}

let singleton: FakeGitStorage | undefined;

export function getFakeGitStorage(
  namespace = "cloudflare-git"
): FakeGitStorage {
  singleton ??= new FakeGitStorage(namespace);
  return singleton;
}
