import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { projects } from "@db/schema";
import { createApp } from "@worker/app";
import {
  closeTestDatabase,
  getTestDatabase,
  resetDatabase,
  testDatabaseUrl,
} from "../helpers/db";

const origin = "http://localhost:5173";
const accountId = "0123456789abcdef0123456789abcdef";

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
  } as unknown as Env;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeTestDatabase();
});

async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if ((init.method ?? "GET") !== "GET") headers.set("origin", origin);
  return app.request(`${origin}${path}`, { ...init, headers }, env);
}

async function createProject(): Promise<{
  repoName: string;
  remote: string;
}> {
  const signup = await call("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Proxy Owner",
      email: "proxy@example.com",
      username: "proxyowner",
      password: "correct-horse-battery-staple",
    }),
  });
  expect(signup.status).toBe(200);
  const cookie = signup.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();

  const group = await call("/api/v1/groups", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie! },
    body: JSON.stringify({
      slug: "proxy-group",
      name: "Proxy Group",
      description: "",
      visibility: "private",
    }),
  });
  expect(group.status).toBe(201);

  const created = await call("/api/v1/groups/proxy-group/projects", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie! },
    body: JSON.stringify({
      slug: "proxy-project",
      name: "Proxy Project",
      visibility: "private",
    }),
  });
  expect(created.status).toBe(201);

  const { db } = await getTestDatabase();
  const [project] = await db.select().from(projects).limit(1);
  if (!project) throw new Error("Project was not created");
  const remote = `https://${accountId}.artifacts.cloudflare.net/git/deesha-git/${project.artifactsRepoName}.git`;
  await db
    .update(projects)
    .set({ artifactsRemote: remote })
    .where(eq(projects.id, project.id));
  return { repoName: project.artifactsRepoName, remote };
}

function stubUpstream(
  handler: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Response | Promise<Response>
) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("Git smart-HTTP proxy", () => {
  it("forwards info/refs to the stored Artifacts remote", async () => {
    const { repoName, remote } = await createProject();
    const upstream = stubUpstream(
      () =>
        new Response("advertisement", {
          status: 200,
          headers: {
            "content-type": "application/x-git-upload-pack-advertisement",
            "cache-control": "private",
          },
        })
    );

    const response = await call(
      `/git/deesha-git/${repoName}.git/info/refs?service=git-upload-pack`,
      {
        headers: {
          authorization: "Bearer art_test",
          cookie: "session=must-not-leak",
          "git-protocol": "version=2",
        },
      }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("advertisement");
    expect(response.headers.get("content-type")).toBe(
      "application/x-git-upload-pack-advertisement"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0]!;
    expect(String(url)).toBe(`${remote}/info/refs?service=git-upload-pack`);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer art_test");
    expect(headers.get("git-protocol")).toBe("version=2");
    expect(headers.get("cookie")).toBeNull();
  });

  it("streams push requests to git-receive-pack", async () => {
    const { repoName } = await createProject();
    const upstream = stubUpstream(async (_input, init) => {
      const body = await new Response(init?.body).text();
      return new Response(`received:${body}`, { status: 200 });
    });

    const response = await call(
      `/git/deesha-git/${repoName}.git/git-receive-pack`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer art_write",
          "content-type": "application/x-git-receive-pack-request",
          "content-length": "8",
        },
        body: "packfile",
      }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("received:packfile");
    expect(upstream).toHaveBeenCalledTimes(1);
    const forwarded = new Headers(upstream.mock.calls[0]?.[1]?.headers);
    expect(forwarded.get("content-length")).toBe("8");
    expect(forwarded.get("cookie")).toBeNull();
  });

  it("requires an Artifacts token and rejects unknown repositories", async () => {
    const { repoName } = await createProject();
    const upstream = stubUpstream(() => new Response("unexpected"));

    const unauthenticated = await call(
      `/git/deesha-git/${repoName}.git/info/refs?service=git-upload-pack`
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toContain("Basic");

    const unknown = await call(
      "/git/deesha-git/p-doesnotexist.git/info/refs?service=git-upload-pack",
      { headers: { authorization: "Bearer art_test" } }
    );
    expect(unknown.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("only accepts Git smart-HTTP operations", async () => {
    const { repoName } = await createProject();
    const upstream = stubUpstream(() => new Response("unexpected"));

    const unsupported = await call(
      `/git/deesha-git/${repoName}.git/objects/info/packs`,
      { headers: { authorization: "Bearer art_test" } }
    );
    expect(unsupported.status).toBe(404);

    const wrongMethod = await call(
      `/git/deesha-git/${repoName}.git/info/refs?service=git-upload-pack`,
      { method: "PUT", headers: { authorization: "Bearer art_test" } }
    );
    expect(wrongMethod.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });
});
