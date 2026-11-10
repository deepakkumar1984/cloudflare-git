import { Hono } from "hono";
import { GIT_PROVIDER_LABELS, type GitProvider } from "@shared/constants";
import { atLeast, canCreateProject } from "@shared/permissions";
import {
  projectImportRetrySchema,
  projectImportSchema,
  projectImportUrlSchema,
} from "@shared/schemas";
import { getGitStorage } from "@worker/artifacts";
import type { AppEnv } from "@worker/env";
import {
  conflict,
  forbidden,
  isUniqueViolation,
  readJson,
  tooManyRequests,
} from "@worker/lib/errors";
import { consumeRateLimit } from "@worker/lib/rate-limit";
import {
  assertAuthenticated,
  assertGroupWritable,
  assertProjectWritable,
  assertRole,
  loadGroup,
  loadProject,
  projectSummary,
} from "@worker/services/access";
import {
  parseProviderRepositoryUrl,
  type ProviderEnv,
} from "@worker/services/git-providers";
import {
  createImportedProject,
  createImportedProjectFromUrl,
  importSummary,
  latestProjectImport,
  pollProjectImport,
  reimportProject,
} from "@worker/services/project-imports";
import { projectVisibilityAllowed } from "@worker/services/projects";
import {
  optionalProviderConnectionToken,
  requireProviderConnection,
} from "@worker/services/provider-connections";
import { providerTokenSecret } from "@worker/services/token-vault";

function requirePrivateToken(
  provider: GitProvider,
  token: string | null
): string {
  if (!token) {
    throw conflict(
      `Connect your ${GIT_PROVIDER_LABELS[provider]} account to import a private repository`
    );
  }
  return token;
}

export const projectImportRoutes = new Hono<AppEnv>();

projectImportRoutes.post(
  "/groups/:groupSlug/projects/import",
  loadGroup,
  async (c) => {
    const session = assertAuthenticated(c);
    const group = c.get("group");
    const groupRole = c.get("groupRole");
    if (!canCreateProject(groupRole)) throw forbidden();
    assertGroupWritable(c);
    const input = await readJson(c, projectImportSchema);
    if (!projectVisibilityAllowed(group, input.visibility)) {
      throw conflict(
        "Project visibility cannot be broader than its group visibility"
      );
    }
    const rate = consumeRateLimit(
      `project-import:${session.user.id}`,
      10,
      60_000
    );
    if (!rate.allowed) {
      throw tooManyRequests(
        "Too many imports started. Wait a minute and try again.",
        rate.retryAfterSeconds
      );
    }

    const db = c.get("db");
    const { token } = await requireProviderConnection(
      db,
      providerTokenSecret(c.env),
      session.user.id,
      input.provider
    );

    try {
      const created = await createImportedProject(
        db,
        getGitStorage(c.env),
        c.env as ProviderEnv,
        session.user.id,
        { ...input, groupId: group.id },
        token
      );
      const role = atLeast(groupRole, "owner") ? "owner" : "maintainer";
      return c.json(
        {
          project: projectSummary(created.project, role),
          import: importSummary(created.import),
        },
        201
      );
    } catch (error) {
      if (isUniqueViolation(error, "projects.group_id, projects.slug")) {
        throw conflict("That project path is already taken");
      }
      throw error;
    }
  }
);

projectImportRoutes.post(
  "/groups/:groupSlug/projects/import/url",
  loadGroup,
  async (c) => {
    const session = assertAuthenticated(c);
    const group = c.get("group");
    const groupRole = c.get("groupRole");
    if (!canCreateProject(groupRole)) throw forbidden();
    assertGroupWritable(c);
    const input = await readJson(c, projectImportUrlSchema);
    if (!projectVisibilityAllowed(group, input.visibility)) {
      throw conflict(
        "Project visibility cannot be broader than its group visibility"
      );
    }
    const rate = consumeRateLimit(
      `project-import:${session.user.id}`,
      10,
      60_000
    );
    if (!rate.allowed) {
      throw tooManyRequests(
        "Too many imports started. Wait a minute and try again.",
        rate.retryAfterSeconds
      );
    }

    const db = c.get("db");
    const parsed = parseProviderRepositoryUrl(
      input.sourceUrl,
      c.env as ProviderEnv
    );
    const connectedToken = await optionalProviderConnectionToken(
      db,
      providerTokenSecret(c.env),
      session.user.id,
      parsed.provider
    );
    const token =
      input.repositoryVisibility === "private"
        ? requirePrivateToken(parsed.provider, connectedToken)
        : (connectedToken ?? undefined);

    try {
      const created = await createImportedProjectFromUrl(
        db,
        getGitStorage(c.env),
        c.env as ProviderEnv,
        session.user.id,
        { ...input, groupId: group.id },
        token
      );
      const role = atLeast(groupRole, "owner") ? "owner" : "maintainer";
      return c.json(
        {
          project: projectSummary(created.project, role),
          import: importSummary(created.import),
        },
        201
      );
    } catch (error) {
      if (isUniqueViolation(error, "projects.group_id, projects.slug")) {
        throw conflict("That project path is already taken");
      }
      throw error;
    }
  }
);

projectImportRoutes.get(
  "/groups/:groupSlug/projects/:projectSlug/import",
  loadProject,
  async (c) => {
    const project = c.get("project");
    const role = c.get("role");
    const job = await pollProjectImport(
      c.get("db"),
      getGitStorage(c.env),
      c.env,
      project.id
    );
    return c.json({
      import: job ? importSummary(job) : null,
      canReimport:
        atLeast(role, "maintainer") &&
        !project.archivedAt &&
        !c.get("group").archivedAt,
    });
  }
);

projectImportRoutes.post(
  "/groups/:groupSlug/projects/:projectSlug/import/retry",
  loadProject,
  async (c) => {
    const session = assertAuthenticated(c);
    const project = c.get("project");
    assertRole(c, "maintainer");
    assertProjectWritable(c);
    const body = await readJson(c, projectImportRetrySchema);
    const last = await latestProjectImport(c.get("db"), project.id);
    if (!last) {
      throw conflict(
        "This project was not created from an external repository"
      );
    }
    const rate = consumeRateLimit(
      `project-reimport:${session.user.id}:${project.id}`,
      5,
      60_000
    );
    if (!rate.allowed) {
      throw tooManyRequests(
        "Too many re-import attempts. Wait a minute and try again.",
        rate.retryAfterSeconds
      );
    }

    const connectedToken = await optionalProviderConnectionToken(
      c.get("db"),
      providerTokenSecret(c.env),
      session.user.id,
      last.provider
    );
    const token = last.repositoryPrivate
      ? requirePrivateToken(last.provider, connectedToken)
      : (connectedToken ?? undefined);
    const job = await reimportProject(
      c.get("db"),
      getGitStorage(c.env),
      c.env as ProviderEnv,
      project,
      session.user.id,
      token,
      body
    );
    return c.json({ import: importSummary(job) }, 202);
  }
);
