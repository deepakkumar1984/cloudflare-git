import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { gitTokenGrants } from "@db/schema";
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

describe("API flow", () => {
  it("runs auth, project provisioning, MR review, search, and access control", async () => {
    const ownerCookie = await signup("Owner User", "owner-api");
    const reviewerCookie = await signup("Reviewer User", "reviewerapi");
    const outsiderCookie = await signup("Outsider User", "outsiderapi");
    const guestCookie = await signup("Guest User", "guestapi");

    const group = await call("/api/v1/groups", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        slug: "api-group",
        name: "API Group",
        description: "API test group",
        visibility: "private",
      },
    });
    expect(group.status).toBe(201);

    const me = await call("/api/v1/me", { cookie: ownerCookie });
    const ownerId = (me.json!.user as { id: string }).id;
    const demoteOwner = await call(
      `/api/v1/groups/api-group/members/${ownerId}`,
      {
        method: "PATCH",
        cookie: ownerCookie,
        body: { role: "maintainer" },
      }
    );
    expect(demoteOwner.status).toBe(409);

    const project = await call("/api/v1/groups/api-group/projects", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        slug: "api-project",
        name: "API Project",
        visibility: "private",
      },
    });
    expect(project.status).toBe(201);
    const projectBody = project.json?.project as {
      id: string;
      provisioningState: string;
    };
    expect(projectBody.provisioningState).toBe("ready");

    const seedMain = await call(
      "/api/v1/groups/api-group/projects/api-project/repository/dev-seed",
      { method: "POST", cookie: ownerCookie, body: {} }
    );
    expect(seedMain.status).toBe(200);
    const seedFeature = await call(
      "/api/v1/groups/api-group/projects/api-project/repository/dev-seed",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { branch: "feature/api", baseBranch: "main" },
      }
    );
    expect(seedFeature.status).toBe(200);

    const addReviewer = await call(
      "/api/v1/groups/api-group/projects/api-project/members",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { identifier: "reviewerapi", role: "developer" },
      }
    );
    expect(addReviewer.status).toBe(201);
    const reviewerId = (addReviewer.json!.member as { user: { id: string } })
      .user.id;
    const addGuest = await call(
      "/api/v1/groups/api-group/projects/api-project/members",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { identifier: "guestapi", role: "guest" },
      }
    );
    expect(addGuest.status).toBe(201);
    const guestId = (addGuest.json!.member as { user: { id: string } }).user.id;

    const issue = await call(
      "/api/v1/groups/api-group/projects/api-project/issues",
      {
        method: "POST",
        cookie: ownerCookie,
        body: {
          title: "Assigned issue",
          description: "Confirm opaque Better Auth user IDs are accepted.",
          assigneeIds: [reviewerId],
          labelIds: [],
        },
      }
    );
    expect(issue.status).toBe(201);
    expect(
      (issue.json!.issue as { assignees: Array<{ id: string }> }).assignees[0]
        ?.id
    ).toBe(reviewerId);

    const confidentialIssue = await call(
      "/api/v1/groups/api-group/projects/api-project/issues",
      {
        method: "POST",
        cookie: ownerCookie,
        body: {
          title: "Secret guest-assigned work",
          description: "Must not leak to the guest dashboard.",
          assigneeIds: [guestId],
          labelIds: [],
          confidential: true,
        },
      }
    );
    expect(confidentialIssue.status).toBe(201);

    const guestDashboard = await call("/api/v1/dashboard", {
      cookie: guestCookie,
    });
    expect(guestDashboard.status).toBe(200);
    expect(guestDashboard.json!.assignedIssues).toEqual([]);

    const guestCreate = await call(
      "/api/v1/groups/api-group/projects/api-project/issues",
      {
        method: "POST",
        cookie: guestCookie,
        body: { title: "Guest cannot do this", description: "" },
      }
    );
    expect(guestCreate.status).toBe(403);

    const guestClone = await call(
      "/api/v1/groups/api-group/projects/api-project/clone_credentials",
      { method: "POST", cookie: guestCookie, body: { scope: "read" } }
    );
    expect(guestClone.status).toBe(403);

    const guestMembers = await call(
      "/api/v1/groups/api-group/projects/api-project/members",
      { cookie: guestCookie }
    );
    expect(guestMembers.status).toBe(200);
    expect(
      (
        guestMembers.json!.members as Array<{ user: { email: string | null } }>
      ).every((member) => member.user.email === null)
    ).toBe(true);
    const ownerMembers = await call(
      "/api/v1/groups/api-group/projects/api-project/members",
      { cookie: ownerCookie }
    );
    expect(
      (
        ownerMembers.json!.members as Array<{ user: { email: string | null } }>
      ).some((member) => member.user.email?.includes("@"))
    ).toBe(true);

    const missingOrigin = await app.request(
      `${origin}/api/v1/groups`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ownerCookie,
        },
        body: JSON.stringify({
          slug: "no-origin",
          name: "No origin",
          description: "",
        }),
      },
      env
    );
    expect(missingOrigin.status).toBe(403);

    const guestIssues = await call(
      "/api/v1/groups/api-group/projects/api-project/issues?state=all",
      { cookie: guestCookie }
    );
    expect(guestIssues.status).toBe(200);
    expect(
      (guestIssues.json!.issues as Array<{ confidential: boolean }>).every(
        (item) => !item.confidential
      )
    ).toBe(true);

    const guestActivity = await call(
      "/api/v1/groups/api-group/projects/api-project/activity",
      { cookie: guestCookie }
    );
    expect(guestActivity.status).toBe(200);
    expect(
      (
        guestActivity.json!.activity as Array<{
          metadata: Record<string, unknown>;
        }>
      ).every((item) => item.metadata.title === undefined)
    ).toBe(true);

    const mr = await call(
      "/api/v1/groups/api-group/projects/api-project/merge_requests",
      {
        method: "POST",
        cookie: ownerCookie,
        body: {
          title: "API review flow",
          description: "Exercise the merge request endpoints.",
          sourceBranch: "feature/api",
          targetBranch: "main",
          reviewerIds: [reviewerId],
          assigneeIds: [reviewerId],
        },
      }
    );
    expect(mr.status).toBe(201);
    const iid = (mr.json!.mergeRequest as { iid: number }).iid;

    const guestDiff = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}/diff`,
      { cookie: guestCookie }
    );
    expect(guestDiff.status).toBe(403);
    const guestPatch = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}/diff/file?path=README.md`,
      { cookie: guestCookie }
    );
    expect(guestPatch.status).toBe(403);
    const guestCommits = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}/commits`,
      { cookie: guestCookie }
    );
    expect(guestCommits.status).toBe(403);

    const reviewerFilter = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests?reviewer=${reviewerId}`,
      { cookie: reviewerCookie }
    );
    expect(reviewerFilter.status).toBe(200);
    expect(reviewerFilter.json!.total).toBe(1);

    const issueFilter = await call(
      `/api/v1/groups/api-group/projects/api-project/issues?assignee=${reviewerId}`,
      { cookie: reviewerCookie }
    );
    expect(issueFilter.status).toBe(200);
    expect(issueFilter.json!.total).toBe(1);

    const reviewerView = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}`,
      { cookie: reviewerCookie }
    );
    expect(reviewerView.status).toBe(200);
    expect(
      (reviewerView.json!.mergeRequest as { canReview: boolean }).canReview
    ).toBe(true);

    const approve = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}/review`,
      {
        method: "POST",
        cookie: reviewerCookie,
        body: { state: "approved" },
      }
    );
    expect(approve.status).toBe(200);
    expect(
      (approve.json!.mergeRequest as { approvalCount: number }).approvalCount
    ).toBe(1);

    const reseedFeature = await call(
      "/api/v1/groups/api-group/projects/api-project/repository/dev-seed",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { branch: "feature/api", baseBranch: "main" },
      }
    );
    expect(reseedFeature.status).toBe(200);
    const afterReseed = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}`,
      { cookie: reviewerCookie }
    );
    expect(afterReseed.status).toBe(200);
    const reseededMr = afterReseed.json!.mergeRequest as {
      headSha: string;
      approvalCount: number;
    };
    expect(reseededMr.headSha).toBe(
      (reseedFeature.json as { commit: string }).commit
    );
    expect(reseededMr.approvalCount).toBe(0);

    const reviewerCannotMerge = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}/mark_merged`,
      { method: "POST", cookie: reviewerCookie }
    );
    expect(reviewerCannotMerge.status).toBe(403);

    const ownerMerges = await call(
      `/api/v1/groups/api-group/projects/api-project/merge_requests/${iid}/mark_merged`,
      { method: "POST", cookie: ownerCookie }
    );
    expect(ownerMerges.status).toBe(200);
    expect((ownerMerges.json!.mergeRequest as { state: string }).state).toBe(
      "merged"
    );

    const search = await call("/api/v1/search?q=API%20review", {
      cookie: reviewerCookie,
    });
    expect(search.status).toBe(200);
    const mergeRequests = search.json?.mergeRequests as Array<{
      iid: number;
      title: string;
    }>;
    expect(mergeRequests.some((item) => item.iid === iid)).toBe(true);

    const credentials = await call(
      "/api/v1/groups/api-group/projects/api-project/clone_credentials",
      { method: "POST", cookie: reviewerCookie, body: { scope: "write" } }
    );
    expect(credentials.status).toBe(200);
    const token = (credentials.json as { token: string }).token;
    expect(token.length).toBeGreaterThan(20);
    const grants = await (
      await getTestDatabase()
    ).db
      .select()
      .from(gitTokenGrants)
      .where(eq(gitTokenGrants.projectId, projectBody.id));
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.some((grant) => grant.artifactsTokenId === token)).toBe(
      false
    );

    const archive = await call(
      "/api/v1/groups/api-group/projects/api-project/archive",
      { method: "POST", cookie: ownerCookie }
    );
    expect(archive.status).toBe(200);
    const activeGrants = await (
      await getTestDatabase()
    ).db
      .select()
      .from(gitTokenGrants)
      .where(
        and(
          eq(gitTokenGrants.projectId, projectBody.id),
          isNull(gitTokenGrants.revokedAt)
        )
      );
    expect(activeGrants).toHaveLength(0);

    const writeAfterArchive = await call(
      "/api/v1/groups/api-group/projects/api-project/clone_credentials",
      { method: "POST", cookie: reviewerCookie, body: { scope: "write" } }
    );
    expect(writeAfterArchive.status).toBe(409);

    const outsiderView = await call(
      "/api/v1/groups/api-group/projects/api-project",
      { cookie: outsiderCookie }
    );
    expect(outsiderView.status).toBe(404);

    const personal = (
      me.json!.groups as Array<{ slug: string; personal: boolean }>
    ).find((item) => item.personal);
    expect(personal).toBeTruthy();
    const deletePersonal = await call(`/api/v1/groups/${personal!.slug}`, {
      method: "DELETE",
      cookie: ownerCookie,
    });
    expect(deletePersonal.status).toBe(409);

    const doomed = await call("/api/v1/groups/api-group/projects", {
      method: "POST",
      cookie: ownerCookie,
      body: { slug: "doomed", name: "Doomed", visibility: "private" },
    });
    expect(doomed.status).toBe(201);
    const addDeveloper = await call(
      "/api/v1/groups/api-group/projects/doomed/members",
      {
        method: "POST",
        cookie: ownerCookie,
        body: { identifier: "reviewerapi", role: "developer" },
      }
    );
    expect(addDeveloper.status).toBe(201);
    const developerDelete = await call(
      "/api/v1/groups/api-group/projects/doomed",
      { method: "DELETE", cookie: reviewerCookie }
    );
    expect(developerDelete.status).toBe(403);
    const ownerDelete = await call("/api/v1/groups/api-group/projects/doomed", {
      method: "DELETE",
      cookie: ownerCookie,
    });
    expect(ownerDelete.status).toBe(204);
    const projectGone = await call("/api/v1/groups/api-group/projects/doomed", {
      cookie: ownerCookie,
    });
    expect(projectGone.status).toBe(404);

    const extraGroup = await call("/api/v1/groups", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        slug: "doomed-group",
        name: "Doomed group",
        visibility: "private",
      },
    });
    expect(extraGroup.status).toBe(201);
    const nested = await call("/api/v1/groups/doomed-group/projects", {
      method: "POST",
      cookie: ownerCookie,
      body: { slug: "nested", name: "Nested", visibility: "private" },
    });
    expect(nested.status).toBe(201);
    const deleteGroup = await call("/api/v1/groups/doomed-group", {
      method: "DELETE",
      cookie: ownerCookie,
    });
    expect(deleteGroup.status).toBe(204);
    const groupGone = await call("/api/v1/groups/doomed-group", {
      cookie: ownerCookie,
    });
    expect(groupGone.status).toBe(404);
  });
});
