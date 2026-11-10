import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importProxySessions, projectImports } from "@db/schema";
import { createApp } from "@worker/app";
import { encryptProviderToken } from "@worker/services/token-vault";
import {
  closeTestDatabase,
  getTestDatabase,
  resetDatabase,
  testDatabaseUrl,
} from "../helpers/db";

const origin = "http://localhost:5173";
let app: ReturnType<typeof createApp>;
let env: Env;

beforeEach(async () => {
  await resetDatabase();
  app = createApp();
  env = {
    HYPERDRIVE: { connectionString: testDatabaseUrl },
    BETTER_AUTH_SECRET: "test-secret-".repeat(4),
    PROVIDER_TOKEN_KEY: "test-provider-key-".repeat(3),
    BETTER_AUTH_URL: origin,
    APP_URL: origin,
    ADMIN_EMAILS: "",
    ARTIFACTS_FAKE: "true",
    ARTIFACTS_NAMESPACE: "deesha-git",
    ENVIRONMENT: "development",
    GIT_PROVIDERS_FAKE: "true",
  } as unknown as Env;
});

afterAll(async () => {
  await closeTestDatabase();
});

interface CallOptions {
  method?: string;
  cookie?: string;
  body?: unknown;
}

async function call(path: string, options: CallOptions = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (method !== "GET" && method !== "HEAD") {
    headers.set("origin", origin);
  }
  const response = await app.request(
    `${origin}${path}`,
    {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    env
  );
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
  }
  return {
    status: response.status,
    text,
    json,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function signup(name: string, username: string) {
  const result = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: {
      name,
      email: `${username}@example.com`,
      username,
      password: "correct-horse-battery-staple",
    },
  });
  if (result.status !== 200 || !result.cookie) {
    throw new Error(
      `Signup failed: ${result.status} ${JSON.stringify(result.json)}`
    );
  }
  return result.cookie;
}

function proxyTokenHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("provider connections and repository imports", () => {
  it("imports public URLs without a token and uses stored tokens for private URLs", async () => {
    const cookie = await signup("URL Owner", "urlowner");

    const group = await call("/api/v1/groups", {
      method: "POST",
      cookie,
      body: {
        slug: "url-group",
        name: "URL Group",
        visibility: "private",
      },
    });
    expect(group.status).toBe(201);

    const publicImport = await call(
      "/api/v1/groups/url-group/projects/import/url",
      {
        method: "POST",
        cookie,
        body: {
          name: "Public Hello",
          slug: "public-hello",
          sourceUrl: "https://github.com/demo/hello-world",
          repositoryVisibility: "public",
          visibility: "private",
        },
      }
    );
    expect(publicImport.status).toBe(201);
    expect((publicImport.json!.import as { status: string }).status).toBe(
      "ready"
    );
    expect(
      (publicImport.json!.import as { repositoryPrivate: boolean })
        .repositoryPrivate
    ).toBe(false);

    const noConnections = await call("/api/v1/integrations", { cookie });
    expect(noConnections.json!.connections).toEqual([]);

    const publicRetry = await call(
      "/api/v1/groups/url-group/projects/public-hello/import/retry",
      { method: "POST", cookie, body: {} }
    );
    expect(publicRetry.status).toBe(202);
    expect((publicRetry.json!.import as { status: string }).status).toBe(
      "ready"
    );

    const privateDenied = await call(
      "/api/v1/groups/url-group/projects/import/url",
      {
        method: "POST",
        cookie,
        body: {
          name: "Private Denied",
          slug: "private-denied",
          sourceUrl: "https://github.com/demo/private-service",
          repositoryVisibility: "private",
        },
      }
    );
    expect(privateDenied.status).toBe(409);
    expect(privateDenied.text).toContain("Connect your GitHub account");

    const connect = await call("/api/v1/integrations/github/connect", {
      method: "POST",
      cookie,
      body: { token: "fake-token-123" },
    });
    expect(connect.status).toBe(201);

    const privateImport = await call(
      "/api/v1/groups/url-group/projects/import/url",
      {
        method: "POST",
        cookie,
        body: {
          name: "Private URL",
          slug: "private-url",
          sourceUrl: "https://github.com/demo/private-service.git",
          repositoryVisibility: "private",
        },
      }
    );
    expect(privateImport.status).toBe(201);
    expect((privateImport.json!.import as { status: string }).status).toBe(
      "ready"
    );
    expect(
      (privateImport.json!.import as { repositoryPrivate: boolean })
        .repositoryPrivate
    ).toBe(true);

    const privateRetry = await call(
      "/api/v1/groups/url-group/projects/private-url/import/retry",
      { method: "POST", cookie, body: {} }
    );
    expect(privateRetry.status).toBe(202);
    expect((privateRetry.json!.import as { status: string }).status).toBe(
      "ready"
    );
  });

  it("connects a provider, imports a private repo, and re-imports safely", async () => {
    const cookie = await signup("Import Owner", "importowner");
    const me = await call("/api/v1/me", { cookie });
    const ownerId = (me.json!.user as { id: string }).id;

    const group = await call("/api/v1/groups", {
      method: "POST",
      cookie,
      body: {
        slug: "import-group",
        name: "Import Group",
        description: "Import integration group",
        visibility: "private",
      },
    });
    expect(group.status).toBe(201);

    const connect = await call("/api/v1/integrations/github/connect", {
      method: "POST",
      cookie,
      body: { token: "fake-token-123" },
    });
    expect(connect.status).toBe(201);
    expect(connect.text).not.toContain("fake-token-123");
    expect((connect.json!.connection as { username: string }).username).toBe(
      "demo-github"
    );

    const connections = await call("/api/v1/integrations", { cookie });
    expect(connections.status).toBe(200);
    expect((connections.json!.connections as unknown[]).length).toBe(1);

    const repos = await call("/api/v1/integrations/github/repositories", {
      cookie,
    });
    expect(repos.status).toBe(200);
    expect(
      (repos.json!.repositories as Array<{ path: string }>).map(
        (repo) => repo.path
      )
    ).toEqual(["demo/hello-world", "demo/private-service"]);

    const imported = await call("/api/v1/groups/import-group/projects/import", {
      method: "POST",
      cookie,
      body: {
        name: "Private Service",
        slug: "private-service",
        description: "Imported from GitHub",
        visibility: "private",
        provider: "github",
        externalRepo: "demo/private-service",
      },
    });
    expect(imported.status).toBe(201);
    const importedProject = imported.json!.project as {
      id: string;
      slug: string;
      provisioningState: string;
      artifactsRemote: string | null;
    };
    expect(importedProject.provisioningState).toBe("ready");
    expect((imported.json!.import as { status: string }).status).toBe("ready");

    const projectBefore = await call(
      "/api/v1/groups/import-group/projects/private-service",
      { cookie }
    );
    expect(projectBefore.status).toBe(200);
    const projectBeforeBody = projectBefore.json!.project as {
      artifactsRemote: string;
    };
    expect(projectBefore.json!.latestImport).toMatchObject({
      status: "ready",
      provider: "github",
    });
    const oldRemote = projectBeforeBody.artifactsRemote;
    expect(oldRemote).toContain("fake-artifacts.local");

    const repository = await call(
      "/api/v1/groups/import-group/projects/private-service/repository",
      { cookie }
    );
    expect(repository.status).toBe(200);
    expect(
      (repository.json!.branches as Array<{ name: string }>)[0]?.name
    ).toBe("main");

    const seedBranch = await call(
      "/api/v1/groups/import-group/projects/private-service/repository/dev-seed",
      {
        method: "POST",
        cookie,
        body: { branch: "feature/local", baseBranch: "main" },
      }
    );
    expect(seedBranch.status).toBe(200);

    const mr = await call(
      "/api/v1/groups/import-group/projects/private-service/merge_requests",
      {
        method: "POST",
        cookie,
        body: {
          title: "Local work before re-import",
          sourceBranch: "feature/local",
          targetBranch: "main",
        },
      }
    );
    expect(mr.status).toBe(201);
    const iid = (mr.json!.mergeRequest as { iid: number }).iid;

    const reimport = await call(
      "/api/v1/groups/import-group/projects/private-service/import/retry",
      { method: "POST", cookie, body: {} }
    );
    expect(reimport.status).toBe(202);
    expect((reimport.json!.import as { status: string }).status).toBe("ready");

    const projectAfter = await call(
      "/api/v1/groups/import-group/projects/private-service",
      { cookie }
    );
    const newRemote = (
      projectAfter.json!.project as { artifactsRemote: string }
    ).artifactsRemote;
    expect(newRemote).not.toBe(oldRemote);

    const closedMr = await call(
      `/api/v1/groups/import-group/projects/private-service/merge_requests/${iid}`,
      { cookie }
    );
    expect(closedMr.status).toBe(200);
    expect((closedMr.json!.mergeRequest as { state: string }).state).toBe(
      "closed"
    );

    const afterRepository = await call(
      "/api/v1/groups/import-group/projects/private-service/repository",
      { cookie }
    );
    expect(
      (afterRepository.json!.branches as Array<{ name: string }>).map(
        (branch) => branch.name
      )
    ).toEqual(["main"]);

    const disconnect = await call("/api/v1/integrations/github", {
      method: "DELETE",
      cookie,
    });
    expect(disconnect.status).toBe(204);
    const afterDisconnect = await call("/api/v1/integrations", { cookie });
    expect(afterDisconnect.json!.connections).toEqual([]);

    const db = (await getTestDatabase()).db;
    const rawProxyToken = `deesha_import_${Buffer.from(
      crypto.getRandomValues(new Uint8Array(32))
    ).toString("base64url")}`;
    const [proxyImport] = await db
      .insert(projectImports)
      .values({
        projectId: importedProject.id,
        provider: "github",
        externalRepo: "demo/private-service",
        remoteUrl: "https://github.com/demo/private-service.git",
        status: "importing",
        artifactsRepoName: "p-proxytest",
        requestedBy: ownerId,
      })
      .returning();
    if (!proxyImport) throw new Error("Could not create proxy import");
    await db.insert(importProxySessions).values({
      tokenHash: proxyTokenHash(rawProxyToken),
      projectImportId: proxyImport.id,
      provider: "github",
      externalRepo: "demo/private-service",
      gitBaseUrl: "https://github.com",
      encryptedToken: await encryptProviderToken(
        env.PROVIDER_TOKEN_KEY,
        "ghp_private_token"
      ),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const originalFetch = globalThis.fetch;
    const upstreamCalls: Array<{
      url: string;
      authorization: string | null;
    }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      upstreamCalls.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response("git refs", {
        status: 200,
        headers: {
          "content-type": "application/x-git-upload-pack-advertisement",
        },
      });
    }) as typeof fetch;

    try {
      const proxy = await call(
        `/api/v1/import-proxy/${rawProxyToken}/repo.git/info/refs?service=git-upload-pack`
      );
      expect(proxy.status).toBe(200);
      expect(proxy.text).toBe("git refs");
      expect(upstreamCalls).toHaveLength(1);
      expect(upstreamCalls[0]!.url).toBe(
        "https://github.com/demo/private-service.git/info/refs?service=git-upload-pack"
      );
      expect(upstreamCalls[0]!.authorization).toBe(
        `Basic ${Buffer.from("x-access-token:ghp_private_token").toString("base64")}`
      );

      const receivePack = await call(
        `/api/v1/import-proxy/${rawProxyToken}/repo.git/git-receive-pack`
      );
      expect(receivePack.status).toBe(404);
      expect(upstreamCalls).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
