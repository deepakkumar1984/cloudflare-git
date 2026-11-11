import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@db/client";
import { gitCommits, groups, projectImports, session, user } from "@db/schema";
import { createApp } from "@worker/app";
import { isUniqueViolation } from "@worker/lib/errors";
import { upsertCommits } from "@worker/services/repository";
import {
  closeTestDatabase,
  getTestDatabase,
  resetDatabase,
} from "../helpers/db";
import { createGroup, createProject, createUser } from "../helpers/fixtures";

const origin = "http://localhost:5173";
let app: ReturnType<typeof createApp>;
let env: Env;
let db: Database;

beforeEach(async () => {
  await resetDatabase();
  const testDb = await getTestDatabase();
  db = testDb.db;
  app = createApp();
  env = {
    DB: testDb.d1,
    BETTER_AUTH_SECRET: "test-secret-".repeat(4),
    PROVIDER_TOKEN_KEY: "test-provider-key-".repeat(3),
    BETTER_AUTH_URL: origin,
    APP_URL: origin,
    ADMIN_EMAILS: "",
    ARTIFACTS_FAKE: "true",
    APP_NAME: "Test Forge",
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
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD") headers.set("origin", origin);
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

async function signup(username: string) {
  const result = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: {
      name: username,
      email: `${username}@example.com`,
      username,
      password: "correct-horse-battery-staple",
    },
  });
  expect(result.status).toBe(200);
  expect(result.cookie).toBeTruthy();
  return result.cookie!;
}

describe("SQLite auth and dates", () => {
  it("returns the configured app name without a session", async () => {
    const meta = await call("/api/meta");
    expect(meta.status).toBe(200);
    expect(meta.json).toEqual({ appName: "Test Forge", signupOpen: true });
  });

  it("signs up, expires the session, and signs in again", async () => {
    const cookie = await signup("d1-auth");
    const me = await call("/api/v1/me", { cookie });
    expect(me.status).toBe(200);

    await db.update(session).set({ expiresAt: new Date(Date.now() - 60_000) });
    const expired = await call("/api/v1/me", { cookie });
    expect(expired.status).toBe(401);

    const signedIn = await call("/api/auth/sign-in/email", {
      method: "POST",
      body: {
        email: "d1-auth@example.com",
        password: "correct-horse-battery-staple",
      },
    });
    expect(signedIn.status).toBe(200);
    const again = await call("/api/v1/me", { cookie: signedIn.cookie });
    expect(again.status).toBe(200);
  });
});

describe("D1 writes", () => {
  it("chunks commit upserts and round-trips parent arrays", async () => {
    const owner = await createUser(db);
    const group = await createGroup(db, owner.id);
    const project = await createProject(db, { group, creatorId: owner.id });
    const parents = ["a".repeat(40), "b".repeat(40)];
    await upsertCommits(
      db,
      project.id,
      Array.from({ length: 12 }, (_, index) => ({
        hash: index.toString(16).padStart(40, "0"),
        message: `commit ${index}`,
        author: { name: "Ada", email: "ada@example.com" },
        committer: { name: "Ada", email: "ada@example.com" },
        parents,
        authoredAt: new Date("2026-11-10T00:00:00.000Z"),
        committedAt: new Date("2026-11-10T00:00:00.000Z"),
      }))
    );
    const rows = await db
      .select()
      .from(gitCommits)
      .where(eq(gitCommits.projectId, project.id));
    expect(rows).toHaveLength(12);
    expect(rows[0]?.parents).toEqual(parents);
  });

  it("rolls back a batch when a later statement fails", async () => {
    const owner = await createUser(db);
    const groupId = crypto.randomUUID();
    await expect(
      db.batch([
        db.insert(groups).values({
          id: groupId,
          slug: "batch-rollback",
          name: "Rollback",
          createdBy: owner.id,
        }),
        db.insert(user).values({
          id: owner.id,
          name: "duplicate",
          email: "other@example.com",
        }),
      ])
    ).rejects.toThrow();
    const leftover = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.id, groupId));
    expect(leftover).toEqual([]);
  });

  it("returns 409 for duplicate slugs, members, labels, milestones, and imports", async () => {
    const ownerCookie = await signup("d1-owner");
    const otherCookie = await signup("d1-other");
    const group = await call("/api/v1/groups", {
      method: "POST",
      cookie: ownerCookie,
      body: { slug: "d1-group", name: "D1 Group", visibility: "private" },
    });
    expect(group.status).toBe(201);
    const createdGroup = group.json?.group as { createdAt: string } | undefined;
    const createdAt = createdGroup?.createdAt;
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const duplicateGroup = await call("/api/v1/groups", {
      method: "POST",
      cookie: otherCookie,
      body: { slug: "d1-group", name: "Again", visibility: "private" },
    });
    expect(duplicateGroup.status).toBe(409);

    const project = await call("/api/v1/groups/d1-group/projects", {
      method: "POST",
      cookie: ownerCookie,
      body: { slug: "d1-app", name: "D1 App", visibility: "private" },
    });
    expect(project.status).toBe(201);
    const duplicateProject = await call("/api/v1/groups/d1-group/projects", {
      method: "POST",
      cookie: ownerCookie,
      body: { slug: "d1-app", name: "D1 App 2", visibility: "private" },
    });
    expect(duplicateProject.status).toBe(409);

    const member = await call("/api/v1/groups/d1-group/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { identifier: "d1-other", role: "developer" },
    });
    expect(member.status).toBe(201);
    const duplicateMember = await call("/api/v1/groups/d1-group/members", {
      method: "POST",
      cookie: ownerCookie,
      body: { identifier: "d1-other", role: "reporter" },
    });
    expect(duplicateMember.status).toBe(409);

    const projectMember = await call(
      "/api/v1/groups/d1-group/projects/d1-app/members",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { identifier: "d1-other", role: "developer" },
      }
    );
    expect(projectMember.status).toBe(201);
    const duplicateProjectMember = await call(
      "/api/v1/groups/d1-group/projects/d1-app/members",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { identifier: "d1-other", role: "developer" },
      }
    );
    expect(duplicateProjectMember.status).toBe(409);

    const label = await call("/api/v1/groups/d1-group/projects/d1-app/labels", {
      method: "POST",
      cookie: ownerCookie,
      body: { title: "bug", color: "#112233" },
    });
    expect(label.status).toBe(201);
    const duplicateLabel = await call(
      "/api/v1/groups/d1-group/projects/d1-app/labels",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { title: "bug", color: "#112233" },
      }
    );
    expect(duplicateLabel.status).toBe(409);

    const milestone = await call(
      "/api/v1/groups/d1-group/projects/d1-app/milestones",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { title: "v1", dueDate: "2026-12-01" },
      }
    );
    expect(milestone.status).toBe(201);
    const createdMilestone = milestone.json?.milestone as
      | { dueDate: string }
      | undefined;
    expect(createdMilestone?.dueDate).toBe("2026-12-01");
    const duplicateMilestone = await call(
      "/api/v1/groups/d1-group/projects/d1-app/milestones",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { title: "v1" },
      }
    );
    expect(duplicateMilestone.status).toBe(409);

    const [owner] = await db
      .select()
      .from(user)
      .where(eq(user.username, "d1-owner"));
    const [groupRow] = await db
      .select()
      .from(groups)
      .where(eq(groups.slug, "d1-group"));
    expect(owner).toBeTruthy();
    expect(groupRow).toBeTruthy();
    const storedProject = await createProject(db, {
      group: groupRow!,
      creatorId: owner!.id,
      slug: "import-target",
    });
    await db.insert(projectImports).values({
      projectId: storedProject.id,
      provider: "github",
      externalRepo: "octo/example",
      remoteUrl: "https://github.com/octo/example.git",
      status: "pending",
      artifactsRepoName: storedProject.artifactsRepoName,
      requestedBy: owner!.id,
    });
    let unique = false;
    try {
      await db.insert(projectImports).values({
        projectId: storedProject.id,
        provider: "github",
        externalRepo: "octo/example",
        remoteUrl: "https://github.com/octo/example.git",
        status: "importing",
        artifactsRepoName: `${storedProject.artifactsRepoName}-2`,
        requestedBy: owner!.id,
      });
    } catch (error) {
      unique = isUniqueViolation(error, "project_imports.project_id");
    }
    expect(unique).toBe(true);
  });

  it("searches with a query that would exceed the 50-byte LIKE limit", async () => {
    const cookie = await signup("d1-search");
    const group = await call("/api/v1/groups", {
      method: "POST",
      cookie,
      body: { slug: "search-group", name: "Search", visibility: "private" },
    });
    expect(group.status).toBe(201);
    const name = `needle-${"p".repeat(60)}`;
    const query = `${name}${"x".repeat(40)}`;
    expect(new TextEncoder().encode(query).length).toBeGreaterThan(50);
    expect(query.length).toBeLessThanOrEqual(200);
    const project = await call("/api/v1/groups/search-group/projects", {
      method: "POST",
      cookie,
      body: { slug: "needle", name, visibility: "private" },
    });
    expect(project.status).toBe(201);
    const found = await call(`/api/v1/search?q=${encodeURIComponent(query)}`);
    expect(found.status).toBe(401);
    const authed = await call(`/api/v1/search?q=${encodeURIComponent(query)}`, {
      cookie,
    });
    expect(authed.status).toBe(200);
    const projects = authed.json?.projects as Array<{ name: string }>;
    expect(projects.some((project) => project.name === name)).toBe(true);
  });
});
