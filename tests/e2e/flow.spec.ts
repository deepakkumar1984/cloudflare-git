import { expect, test, type Page } from "@playwright/test";

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const groupSlug = `e2e-${stamp}`;
const projectSlug = `app-${stamp}`;
const owner = {
  name: "E2E Owner",
  username: `owner${stamp}`,
  email: `owner-${stamp}@example.com`,
  password: "correct-horse-battery-staple",
};
const reviewer = {
  name: "E2E Reviewer",
  username: `reviewer${stamp}`,
  email: `reviewer-${stamp}@example.com`,
  password: "correct-horse-battery-staple",
};

async function signUp(page: Page, user: typeof owner) {
  await page.goto("/sign-up");
  await page.fill("#name", user.name);
  await page.fill("#username", user.username);
  await page.fill("#email", user.email);
  await page.fill("#new-password", user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("/", { timeout: 20_000 });
}

async function api<T>(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  return page.evaluate(
    async ([path, options]) => {
      const response = await fetch(`/api/v1${path}`, {
        method: options.method ?? "GET",
        credentials: "include",
        headers:
          options.body === undefined
            ? undefined
            : { "content-type": "application/json" },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${response.status} ${text.slice(0, 300)}`);
      }
      return text ? JSON.parse(text) : null;
    },
    [path, options] as const
  );
}

function repoFile(page: Page, name: string) {
  return page.getByRole("button").filter({ hasText: name }).first();
}

test("E2E server uses the fake Artifacts adapter", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const health = (await response.json()) as { artifacts?: string };
  expect(health.artifacts).toBe("fake");
});

test("create, review, and merge-request UI flow", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signUp(ownerPage, owner);

  await api(ownerPage, "/groups", {
    method: "POST",
    body: {
      slug: groupSlug,
      name: "E2E Group",
      description: "Created by the Playwright smoke test",
      visibility: "private",
    },
  });

  await ownerPage.goto(`/groups/${groupSlug}/projects/import`);
  await expect(
    ownerPage.getByRole("heading", { name: "Bring a repository with you." })
  ).toBeVisible();
  await expect(ownerPage.getByLabel("Repository URL")).toBeVisible();
  await ownerPage
    .getByRole("button", { name: "Browse connected repos" })
    .click();
  await expect(
    ownerPage.getByRole("button", { name: "Connect GitHub" })
  ).toBeVisible();
  await ownerPage.getByRole("button", { name: "GitLab" }).click();
  await expect(
    ownerPage.getByRole("button", { name: "Connect GitLab" })
  ).toBeVisible();

  await api(ownerPage, `/groups/${groupSlug}/projects`, {
    method: "POST",
    body: {
      slug: projectSlug,
      name: "E2E Project",
      visibility: "private",
    },
  });
  await api(
    ownerPage,
    `/groups/${groupSlug}/projects/${projectSlug}/repository/dev-seed`,
    { method: "POST", body: {} }
  );
  await api(
    ownerPage,
    `/groups/${groupSlug}/projects/${projectSlug}/repository/dev-seed`,
    { method: "POST", body: { branch: "feature/e2e", baseBranch: "main" } }
  );

  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  await signUp(reviewerPage, reviewer);
  const me = await api<{ user: { id: string } }>(reviewerPage, "/me");
  await api(ownerPage, `/groups/${groupSlug}/projects/${projectSlug}/members`, {
    method: "POST",
    body: { identifier: reviewer.username, role: "developer" },
  });

  await ownerPage.goto(
    `/groups/${groupSlug}/${projectSlug}/merge_requests/new`
  );
  await expect(ownerPage.getByLabel("Source branch")).toBeVisible();
  await ownerPage.getByLabel("Source branch").selectOption("feature/e2e");
  await ownerPage.getByLabel("Target branch").selectOption("main");
  await ownerPage.fill("#mr-title", "E2E review flow");
  await ownerPage.fill(
    "#mr-description",
    "Created by the Playwright smoke test. Review the diff."
  );
  await ownerPage.getByRole("button", { name: "Open merge request" }).click();
  await ownerPage.waitForURL(/\/merge_requests\/\d+$/);
  const iid = ownerPage.url().split("/").pop();
  await api(
    ownerPage,
    `/groups/${groupSlug}/projects/${projectSlug}/merge_requests/${iid}`,
    { method: "PATCH", body: { reviewerIds: [me.user.id] } }
  );

  await reviewerPage.goto(
    `/groups/${groupSlug}/${projectSlug}/merge_requests/${iid}`
  );
  await reviewerPage.getByRole("button", { name: "Approve" }).click();
  await expect(
    reviewerPage.getByRole("button", { name: "Approved" })
  ).toBeVisible();

  await reviewerPage
    .getByPlaceholder("Discuss the change. Markdown is supported.")
    .fill("E2E comment on the merge request.");
  await reviewerPage.getByRole("button", { name: "Comment" }).click();
  await expect(
    reviewerPage.getByText("E2E comment on the merge request.")
  ).toBeVisible();

  await reviewerPage.getByRole("button", { name: /Changes/ }).click();
  await repoFile(reviewerPage, "CHANGELOG.md").click();
  await expect(reviewerPage.locator(".diff-view")).toBeVisible();

  await ownerPage.goto(`/groups/${groupSlug}/${projectSlug}/issues/new`);
  await ownerPage.fill("#issue-title", "E2E issue lifecycle");
  await ownerPage.getByRole("button", { name: "Open issue" }).click();
  await ownerPage.waitForURL(/\/issues\/\d+$/);
  await ownerPage.getByRole("button", { name: "Close issue" }).click();
  await expect(
    ownerPage.getByRole("button", { name: "Reopen issue" })
  ).toBeVisible();

  const labelName = `e2e-label-${stamp}`;
  await ownerPage.goto(`/groups/${groupSlug}/${projectSlug}/labels`);
  await ownerPage.getByRole("button", { name: "New label" }).click();
  await ownerPage.fill("#label-name", labelName);
  await ownerPage.getByRole("button", { name: "Create label" }).click();
  await expect(ownerPage.getByText(labelName).first()).toBeVisible();

  await ownerPage.goto(`/groups/${groupSlug}/${projectSlug}/milestones`);
  await ownerPage.getByRole("button", { name: "New milestone" }).click();
  await ownerPage.fill("#milestone-title", `e2e-milestone-${stamp}`);
  await ownerPage.getByRole("button", { name: "Create milestone" }).click();
  await expect(
    ownerPage.getByText(`e2e-milestone-${stamp}`).first()
  ).toBeVisible();

  await ownerPage.goto(`/groups/${groupSlug}/${projectSlug}/boards`);
  await ownerPage.getByRole("button", { name: "Column", exact: true }).click();
  await ownerPage.fill("#column-name", "E2E Column");
  await ownerPage.selectOption("#column-label", { label: labelName });
  await ownerPage.getByRole("button", { name: "Add column" }).click();
  await expect(ownerPage.getByText("E2E Column").first()).toBeVisible();

  await ownerContext.close();
  await reviewerContext.close();
});

test("imports a public repository by URL without a token", async ({ page }) => {
  const urlStamp = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const urlGroupSlug = `url-${urlStamp}`;
  const urlUser = {
    name: "URL Import Owner",
    username: `urlowner${urlStamp}`,
    email: `urlowner-${urlStamp}@example.com`,
    password: "correct-horse-battery-staple",
  };
  await signUp(page, urlUser);
  await api(page, "/groups", {
    method: "POST",
    body: {
      slug: urlGroupSlug,
      name: "URL Import Group",
      visibility: "private",
    },
  });

  await page.goto(`/groups/${urlGroupSlug}/projects/import`);
  await expect(ownerPageHeading(page)).toBeVisible();
  await page.fill("#source-url", "https://github.com/acme/public-url-demo.git");
  await expect(page.locator("#import-name")).toHaveValue("public-url-demo");
  await expect(
    page.getByText("Public import: no personal access token required.")
  ).toBeVisible();
  await page.fill("#import-description", "Public URL import E2E");
  await page.getByRole("button", { name: "Import repository" }).click();
  await page.waitForURL(new RegExp(`/groups/${urlGroupSlug}/public-url-demo$`));
  await expect(
    page.getByRole("heading", { name: "public-url-demo" })
  ).toBeVisible();

  await page.goto(`/groups/${urlGroupSlug}/public-url-demo/settings`);
  await expect(page.getByText("Provider import")).toBeVisible();
  await expect(page.getByText("Public", { exact: true }).first()).toBeVisible();

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Re-import from provider" }).click();
  await expect(page.getByText("Re-import started")).toBeVisible();
  await expect
    .poll(async () => {
      const result = await api<{ import: { status: string } | null }>(
        page,
        `/groups/${urlGroupSlug}/projects/public-url-demo/import`
      );
      return result.import?.status;
    })
    .toBe("ready");
});

function ownerPageHeading(page: Page) {
  return page.getByRole("heading", { name: "Bring a repository with you." });
}
