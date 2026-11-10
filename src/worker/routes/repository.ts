import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { gitRefs, projects } from "@db/schema";
import { getFakeGitStorage } from "@worker/artifacts/fake-storage";
import { getGitStorage } from "@worker/artifacts";
import type { AppEnv } from "@worker/env";
import { assertRole, loadProject } from "@worker/services/access";
import { recordEvent } from "@worker/services/events";
import {
  getBlob,
  getBranches,
  getCommitDetail,
  getCommits,
  getRawFile,
  getReadme,
  getTree,
  refreshRepositoryRefs,
  toCommitInput,
  upsertCommits,
} from "@worker/services/repository";
import { updateOpenMrsForSourcePush } from "@worker/services/merge-detection";
import { conflict, notFound, readQuery } from "@worker/lib/errors";

export const repositoryRoutes = new Hono<AppEnv>();

const fileQuery = z.object({
  ref: z.string().trim().max(255).optional(),
  path: z.string().max(4096).optional().default(""),
});

const commitListQuery = z.object({
  ref: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(100_000).optional().default(0),
});

function requireReady(project: AppEnv["Variables"]["project"]): void {
  if (project.provisioningState !== "ready") {
    throw conflict("Repository is not ready");
  }
}

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    const db = c.get("db");
    const branches =
      project.provisioningState === "ready"
        ? await getBranches(db, project)
        : [];
    return c.json({
      defaultBranch: project.defaultBranch,
      provisioningState: project.provisioningState,
      remote: project.artifactsRemote,
      branches,
      isEmpty: branches.length === 0,
    });
  }
);

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository/branches",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    if (project.provisioningState !== "ready") {
      return c.json({ branches: [], defaultBranch: project.defaultBranch });
    }
    const branches = await getBranches(c.get("db"), project);
    return c.json({ branches, defaultBranch: project.defaultBranch });
  }
);

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository/tree",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    requireReady(project);
    const query = readQuery(c, fileQuery);
    const result = await getTree(
      c.get("db"),
      getGitStorage(c.env),
      project,
      query.ref || project.defaultBranch,
      query.path
    );
    return c.json(result);
  }
);

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository/blob",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    requireReady(project);
    const query = readQuery(c, fileQuery);
    if (!query.path) throw notFound("File not found");
    const result = await getBlob(
      c.get("db"),
      getGitStorage(c.env),
      project,
      query.ref || project.defaultBranch,
      query.path
    );
    return c.json(result);
  }
);

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository/raw",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    requireReady(project);
    const query = readQuery(c, fileQuery);
    if (!query.path) throw notFound("File not found");
    const result = await getRawFile(
      c.get("db"),
      getGitStorage(c.env),
      project,
      query.ref || project.defaultBranch,
      query.path
    );
    const safeName = result.filename.replace(/["\r\n]/g, "_");
    return new Response(result.blob, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(result.size),
        "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
);

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository/commits",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    requireReady(project);
    const query = readQuery(c, commitListQuery);
    const result = await getCommits(
      c.get("db"),
      getGitStorage(c.env),
      project,
      query.ref || project.defaultBranch,
      query.limit,
      query.offset
    );
    return c.json(result);
  }
);

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository/commits/:sha",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    requireReady(project);
    const sha = c.req.param("sha");
    if (!sha) throw notFound("Commit not found");
    const result = await getCommitDetail(
      c.get("db"),
      getGitStorage(c.env),
      project,
      sha
    );
    return c.json(result);
  }
);

repositoryRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/repository/readme",
  loadProject,
  async (c) => {
    assertRole(c, "reporter");
    const project = c.get("project");
    if (project.provisioningState !== "ready") return c.json({ readme: null });
    const readme = await getReadme(getGitStorage(c.env), project);
    return c.json({ readme });
  }
);

repositoryRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/repository/refresh",
  loadProject,
  async (c) => {
    assertRole(c, "maintainer");
    const project = c.get("project");
    requireReady(project);
    const result = await refreshRepositoryRefs(
      c.get("db"),
      getGitStorage(c.env),
      project
    );
    return c.json(result);
  }
);

/**
 * Development-only helper so the fake Artifacts adapter has something to
 * render. Never available with the real binding or in production.
 */
repositoryRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/repository/dev-seed",
  loadProject,
  async (c) => {
    if (
      c.env.ENVIRONMENT !== "development" ||
      c.env.ARTIFACTS_FAKE !== "true"
    ) {
      throw notFound();
    }
    assertRole(c, "reporter");
    const project = c.get("project");
    const db = c.get("db");
    const fake = getFakeGitStorage();

    try {
      await fake.getRepositoryInfo(project.artifactsRepoName);
    } catch {
      await fake.createRepository(project.artifactsRepoName, {
        description: project.description,
        setDefaultBranch: project.defaultBranch,
      });
    }

    const body = await c.req
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const branchPattern = /^[A-Za-z0-9._/-]{1,255}$/;
    const branch =
      typeof body.branch === "string" &&
      branchPattern.test(body.branch) &&
      !body.branch.includes("..")
        ? body.branch
        : project.defaultBranch;
    const baseBranch =
      typeof body.baseBranch === "string" &&
      branchPattern.test(body.baseBranch) &&
      !body.baseBranch.includes("..")
        ? body.baseBranch
        : project.defaultBranch;

    const currentRefs = await fake.listRefs(project.artifactsRepoName);
    const branchExists = currentRefs.some(
      (ref) => ref.ref === `refs/heads/${branch}`
    );
    const baseSha = currentRefs.find(
      (ref) => ref.ref === `refs/heads/${baseBranch}`
    )?.oid;
    const timestamp = Math.floor(Date.now() / 1_000);
    const baseFiles: Record<string, string> = {
      "README.md": `# ${project.name}\n\n${project.description || "A project on Deesha Git."}\n\n## Getting started\n\n- Browse the tree in the repository tab\n- Open an issue from the issue board\n- Push a branch and open a merge request\n`,
      ".gitignore": "node_modules/\ndist/\n.env\n.dev.vars\n",
      "src/index.ts": `export function hello(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(hello("Deesha"));\n`,
      "docs/architecture.md": `# Architecture\n\nThis repository is stored in Cloudflare Artifacts.\n\n- \`src/\` contains application code\n- \`docs/\` contains design notes\n`,
      "package.json": JSON.stringify(
        {
          name: project.slug,
          private: true,
          type: "module",
          scripts: { start: "tsx src/index.ts" },
        },
        null,
        2
      ),
    };
    const featureFiles =
      branch === project.defaultBranch
        ? baseFiles
        : {
            ...baseFiles,
            "README.md": `${baseFiles["README.md"]}\n## Review this branch\n\nThe demo branch updates the greeting and adds a changelog so the merge request has a real diff.\n`,
            "CHANGELOG.md":
              "# Changelog\n\n## Unreleased\n\n- Add a friendlier greeting\n",
            "src/index.ts": `export function hello(name: string): string {\n  return \`Hello, \${name}! Welcome to Deesha.\`;\n}\n\nexport function farewell(name: string): string {\n  return \`Goodbye, \${name}.\`;\n}\n\nconsole.log(hello("Deesha"));\n`,
          };
    const seed = fake.seedCommit(project.artifactsRepoName, {
      branch,
      parentSha: branchExists ? undefined : baseSha,
      message: branchExists
        ? `Update ${branch} demo files`
        : branch === project.defaultBranch
          ? "Initial commit from Deesha demo data"
          : "Add friendlier greeting and changelog",
      timestamp,
      files: featureFiles,
    });

    await upsertCommits(db, project.id, [toCommitInput(seed)]);
    await db
      .insert(gitRefs)
      .values({
        projectId: project.id,
        refName: `refs/heads/${branch}`,
        refType: "branch",
        sha: seed.hash,
        lastEventAt: new Date(),
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: [gitRefs.projectId, gitRefs.refName],
        set: {
          sha: seed.hash,
          deletedAt: null,
          lastEventAt: new Date(),
          updatedAt: new Date(),
        },
      });
    await updateOpenMrsForSourcePush(db, project.id, branch, seed.hash);
    await db
      .update(projects)
      .set({
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
        artifactsRemote: sql`coalesce(${projects.artifactsRemote}, ${`https://fake-artifacts.local/git/deesha-git/${project.artifactsRepoName}.git`})`,
      })
      .where(eq(projects.id, project.id));
    await recordEvent(db, {
      projectId: project.id,
      groupId: project.groupId,
      actorId: c.get("session")?.user.id,
      action: "push",
      targetType: "ref",
      targetId: `refs/heads/${branch}`,
      metadata: {
        ref: `refs/heads/${branch}`,
        after: seed.hash,
        commitCount: 1,
        unverifiedAuthor: seed.author,
        demo: true,
      },
      dedupeKey: `dev-seed:${project.id}:${branch}:${seed.hash}`,
    });

    return c.json({ commit: seed.hash, branch, baseSha: baseSha ?? null });
  }
);
