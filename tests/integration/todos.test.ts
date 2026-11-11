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
    throw new Error(`Signup failed: ${result.status}`);
  }
  return result.cookie;
}

const P = "/api/v1/groups/todo-group/projects/todo-project";

describe("to-dos", () => {
  it("creates to-dos for assignment, review request, and mention; supports done and restore", async () => {
    const owner = await signup("Owner", "ownertodo");
    const member = await signup("Member", "membertodo");
    const outsider = await signup("Outsider", "outsidertodo");

    await call("/api/v1/groups", {
      method: "POST",
      cookie: owner,
      body: { slug: "todo-group", name: "Todo Group", visibility: "private" },
    });
    await call("/api/v1/groups/todo-group/projects", {
      method: "POST",
      cookie: owner,
      body: {
        slug: "todo-project",
        name: "Todo Project",
        visibility: "private",
      },
    });
    await call(`${P}/repository/dev-seed`, {
      method: "POST",
      cookie: owner,
      body: {},
    });
    await call(`${P}/repository/dev-seed`, {
      method: "POST",
      cookie: owner,
      body: { branch: "feature/todo", baseBranch: "main" },
    });
    await call("/api/v1/groups/todo-group/members", {
      method: "POST",
      cookie: owner,
      body: { identifier: "membertodo", role: "developer" },
    });
    const memberMe = await call("/api/v1/me", { cookie: member });
    const memberId = (memberMe.json!.user as { id: string }).id;

    // Assignment creates a to-do for the assignee, not the actor.
    const issue = await call(`${P}/issues`, {
      method: "POST",
      cookie: owner,
      body: { title: "Assigned work", assigneeIds: [memberId] },
    });
    expect(issue.status).toBe(201);
    const issueIid = (issue.json!.issue as { iid: number }).iid;

    // Review request creates a to-do for the reviewer.
    const mr = await call(`${P}/merge_requests`, {
      method: "POST",
      cookie: owner,
      body: {
        title: "Review me",
        sourceBranch: "feature/todo",
        targetBranch: "main",
        reviewerIds: [memberId],
      },
    });
    expect(mr.status).toBe(201);

    // Mention creates a to-do for the mentioned member.
    const comment = await call(`${P}/issues/${issueIid}/notes`, {
      method: "POST",
      cookie: owner,
      body: { body: "hey @membertodo can you look at this?" },
    });
    expect(comment.status).toBe(201);

    const list = await call("/api/v1/todos", { cookie: member });
    expect(list.status).toBe(200);
    const todos = list.json!.todos as Array<{
      id: string;
      action: string;
      state: string;
    }>;
    expect(list.json!.pendingCount).toBe(3);
    expect(todos.map((t) => t.action).sort()).toEqual([
      "assigned",
      "mentioned",
      "review_requested",
    ]);

    // The actor has no to-dos from their own actions.
    const ownerList = await call("/api/v1/todos", { cookie: owner });
    expect(ownerList.json!.pendingCount).toBe(0);

    // Outsider sees nothing.
    const outsiderList = await call("/api/v1/todos", { cookie: outsider });
    expect(outsiderList.json!.pendingCount).toBe(0);

    // Mark one done.
    const done = await call(`/api/v1/todos/${todos[0]!.id}/done`, {
      method: "POST",
      cookie: member,
    });
    expect(done.status).toBe(200);
    const afterDone = await call("/api/v1/todos", { cookie: member });
    expect(afterDone.json!.pendingCount).toBe(2);
    const doneTab = await call("/api/v1/todos?state=done", { cookie: member });
    expect((doneTab.json!.todos as unknown[]).length).toBe(1);

    // Restore it.
    const restore = await call(`/api/v1/todos/${todos[0]!.id}/pending`, {
      method: "POST",
      cookie: member,
    });
    expect(restore.status).toBe(200);

    // Another user cannot mark someone else's to-do done.
    const foreign = await call(`/api/v1/todos/${todos[0]!.id}/done`, {
      method: "POST",
      cookie: outsider,
    });
    expect(foreign.status).toBe(404);

    // Mark all done.
    const all = await call("/api/v1/todos/done-all", {
      method: "POST",
      cookie: member,
    });
    expect(all.status).toBe(200);
    const count = await call("/api/v1/todos/count", { cookie: member });
    expect(count.json!.count).toBe(0);
  });

  it("does not duplicate a pending to-do when re-assigning the same user", async () => {
    const owner = await signup("Owner", "ownertodo2");
    const member = await signup("Member", "membertodo2");
    await call("/api/v1/groups", {
      method: "POST",
      cookie: owner,
      body: { slug: "todo-group", name: "Todo Group", visibility: "private" },
    });
    await call("/api/v1/groups/todo-group/projects", {
      method: "POST",
      cookie: owner,
      body: {
        slug: "todo-project",
        name: "Todo Project",
        visibility: "private",
      },
    });
    await call("/api/v1/groups/todo-group/members", {
      method: "POST",
      cookie: owner,
      body: { identifier: "membertodo2", role: "developer" },
    });
    const memberMe = await call("/api/v1/me", { cookie: member });
    const memberId = (memberMe.json!.user as { id: string }).id;

    const issue = await call(`${P}/issues`, {
      method: "POST",
      cookie: owner,
      body: { title: "Dup check", assigneeIds: [memberId] },
    });
    const iid = (issue.json!.issue as { iid: number }).iid;
    // Re-save with the same assignee: no new to-do.
    await call(`${P}/issues/${iid}`, {
      method: "PATCH",
      cookie: owner,
      body: { assigneeIds: [memberId] },
    });
    const list = await call("/api/v1/todos", { cookie: member });
    expect(list.json!.pendingCount).toBe(1);
  });
});
