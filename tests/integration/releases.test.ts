import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@worker/app";
import {
  closeTestDatabase,
  getTestDatabase,
  resetDatabase,
} from "../helpers/db";

const origin = "http://localhost:5173";
let app: ReturnType<typeof createApp>;
let env: Env;

beforeEach(async () => {
  await resetDatabase();
  app = createApp();
  env = {
    DB: (await getTestDatabase()).d1,
    BETTER_AUTH_SECRET: "test-secret-".repeat(4),
    PROVIDER_TOKEN_KEY: "test-provider-key-".repeat(3),
    BETTER_AUTH_URL: origin,
    APP_URL: origin,
    ADMIN_EMAILS: "",
    ARTIFACTS_FAKE: "true",
    ARTIFACTS_NAMESPACE: "cloudflare-git",
    ENVIRONMENT: "development",
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
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  return {
    status: response.status,
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

const P = "/api/v1/groups/rel-group/projects/rel-project";

async function setupProject(ownerCookie: string) {
  await call("/api/v1/groups", {
    method: "POST",
    cookie: ownerCookie,
    body: { slug: "rel-group", name: "Release Group", visibility: "private" },
  });
  await call("/api/v1/groups/rel-group/projects", {
    method: "POST",
    cookie: ownerCookie,
    body: {
      slug: "rel-project",
      name: "Release Project",
      visibility: "private",
    },
  });
  const seed = await call(`${P}/repository/dev-seed`, {
    method: "POST",
    cookie: ownerCookie,
    body: {},
  });
  expect(seed.status).toBe(200);
}

describe("releases and tags", () => {
  it("lists synced tags and publishes, edits, and deletes a release", async () => {
    const owner = await signup("Owner", "ownerrel");
    await setupProject(owner);

    const tags = await call(`${P}/repository/tags`, { cookie: owner });
    expect(tags.status).toBe(200);
    const tagNames = (tags.json!.tags as Array<{ name: string }>).map(
      (t) => t.name
    );
    expect(tagNames).toContain("v0.1.0");

    const created = await call(`${P}/releases`, {
      method: "POST",
      cookie: owner,
      body: {
        tagName: "v0.1.0",
        title: "v0.1.0 — first release",
        description: "## Highlights\n\n- Initial demo seed",
      },
    });
    expect(created.status).toBe(201);
    const release = created.json!.release as {
      id: string;
      tagName: string;
      tag: { exists: boolean };
    };
    expect(release.tagName).toBe("v0.1.0");
    expect(release.tag.exists).toBe(true);

    const list = await call(`${P}/releases`, { cookie: owner });
    expect(list.status).toBe(200);
    expect((list.json!.releases as unknown[]).length).toBe(1);
    expect(list.json!.canManage).toBe(true);

    const duplicate = await call(`${P}/releases`, {
      method: "POST",
      cookie: owner,
      body: { tagName: "v0.1.0", title: "dup" },
    });
    expect(duplicate.status).toBe(409);

    const missingTag = await call(`${P}/releases`, {
      method: "POST",
      cookie: owner,
      body: { tagName: "v9.9.9", title: "no tag" },
    });
    expect(missingTag.status).toBe(409);

    const badTag = await call(`${P}/releases`, {
      method: "POST",
      cookie: owner,
      body: { tagName: "bad tag name", title: "invalid" },
    });
    expect(badTag.status).toBe(400);

    const updated = await call(`${P}/releases/${release.id}`, {
      method: "PATCH",
      cookie: owner,
      body: { title: "v0.1.0 — revised" },
    });
    expect(updated.status).toBe(200);
    expect((updated.json!.release as { title: string }).title).toBe(
      "v0.1.0 — revised"
    );

    const activity = await call(`${P}/activity`, { cookie: owner });
    const actions = (activity.json!.activity as Array<{ action: string }>).map(
      (a) => a.action
    );
    expect(actions).toContain("release.created");
    expect(actions).toContain("release.updated");

    const deleted = await call(`${P}/releases/${release.id}`, {
      method: "DELETE",
      cookie: owner,
    });
    expect(deleted.status).toBe(204);
    const after = await call(`${P}/releases`, { cookie: owner });
    expect((after.json!.releases as unknown[]).length).toBe(0);
  });

  it("enforces role and visibility boundaries", async () => {
    const owner = await signup("Owner", "ownerrel2");
    const reporter = await signup("Reporter", "reporterrel");
    const outsider = await signup("Outsider", "outsiderrel");
    await setupProject(owner);
    await call(`${P}/releases`, {
      method: "POST",
      cookie: owner,
      body: { tagName: "v0.1.0", title: "v0.1.0" },
    });

    await call("/api/v1/groups/rel-group/members", {
      method: "POST",
      cookie: owner,
      body: { identifier: "reporterrel", role: "reporter" },
    });

    // Reporter can read releases and tags but not manage them.
    const reporterList = await call(`${P}/releases`, { cookie: reporter });
    expect(reporterList.status).toBe(200);
    expect(reporterList.json!.canManage).toBe(false);
    const reporterTags = await call(`${P}/repository/tags`, {
      cookie: reporter,
    });
    expect(reporterTags.status).toBe(200);
    const reporterCreate = await call(`${P}/releases`, {
      method: "POST",
      cookie: reporter,
      body: { tagName: "v0.1.0", title: "nope" },
    });
    expect(reporterCreate.status).toBe(403);

    // Outsider cannot see the private project's releases or tags.
    const outsiderList = await call(`${P}/releases`, { cookie: outsider });
    expect([403, 404]).toContain(outsiderList.status);
    const outsiderTags = await call(`${P}/repository/tags`, {
      cookie: outsider,
    });
    expect([403, 404]).toContain(outsiderTags.status);
  });
});
