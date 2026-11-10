import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { writeBatch } from "@db/batch";
import type { Database } from "@db/client";
import {
  gitCommits,
  gitRefs,
  gitSyncLeases,
  gitSyncRuns,
  importProxySessions,
  mergeRequests,
  projectImports,
  projects,
  type Project,
  type ProjectImport,
} from "@db/schema";
import {
  GIT_PROVIDER_LABELS,
  IMPORT_PROXY_TTL_SECONDS,
  IMPORT_TOKEN_PREFIX,
  type GitProvider,
} from "@shared/constants";
import type { ArtifactsRepoInfo, GitStorage } from "@worker/artifacts";
import { isArtifactsErrorCode } from "@worker/artifacts/types";
import { AppError, conflict, isUniqueViolation } from "@worker/lib/errors";
import { recordAudit, recordEvent } from "./events";
import { resolveAppOrigin } from "./public-remote";
import {
  getProviderRepository,
  parseProviderRepositoryUrl,
  type ProviderEnv,
  type ProviderRepository,
} from "./git-providers";
import { revokeProjectTokens } from "./git-tokens";
import { createProjectShell, newArtifactsRepoName } from "./projects";
import { refreshRepositoryRefs } from "./repository";
import { encryptProviderToken, providerTokenSecret } from "./token-vault";

const IMPORT_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

export interface ProjectImportSummary {
  id: string;
  provider: GitProvider;
  externalRepo: string;
  branch: string | null;
  depth: number | null;
  repositoryPrivate: boolean;
  status: ProjectImport["status"];
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreateImportedProjectInput {
  groupId: string;
  slug: string;
  name: string;
  description: string;
  visibility: "private" | "internal";
  provider: GitProvider;
  externalRepo: string;
  branch?: string;
  depth?: number;
}

export interface CreateImportedProjectFromUrlInput extends Omit<
  CreateImportedProjectInput,
  "provider" | "externalRepo"
> {
  sourceUrl: string;
  repositoryVisibility: "public" | "private";
}

interface BeginImportInput {
  project: Project;
  provider: GitProvider;
  repository: ProviderRepository;
  token: string | undefined;
  requestedBy: string | null;
  branch?: string;
  depth?: number;
  artifactsRepoName: string;
  previousRepoName: string | null;
  requestUrl?: string;
}

export function importSummary(row: ProjectImport): ProjectImportSummary {
  return {
    id: row.id,
    provider: row.provider,
    externalRepo: row.externalRepo,
    branch: row.branch,
    depth: row.depth,
    repositoryPrivate: row.repositoryPrivate,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export async function latestProjectImport(
  db: Database,
  projectId: string
): Promise<ProjectImport | null> {
  const [row] = await db
    .select()
    .from(projectImports)
    .where(eq(projectImports.projectId, projectId))
    .orderBy(desc(projectImports.createdAt))
    .limit(1);
  return row ?? null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function assertProxyOrigin(env: Env, requestUrl?: string): string {
  const origin = resolveAppOrigin(requestUrl, env.APP_URL);
  if (env.ARTIFACTS_FAKE !== "true" && !origin.startsWith("https://")) {
    throw conflict(
      "Private repository imports require a public https hostname"
    );
  }
  return origin;
}

function proxyUrl(env: Env, rawToken: string, requestUrl?: string): string {
  const origin = assertProxyOrigin(env, requestUrl);
  return `${origin}/api/v1/import-proxy/${rawToken}/repo.git`;
}

async function createProxySession(
  db: Database,
  env: Env,
  importId: string,
  provider: GitProvider,
  repository: ProviderRepository,
  token: string,
  requestUrl?: string
): Promise<string> {
  const rawToken =
    IMPORT_TOKEN_PREFIX + base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(rawToken);
  const encryptedToken = await encryptProviderToken(
    providerTokenSecret(env),
    token
  );
  await db.insert(importProxySessions).values({
    tokenHash,
    projectImportId: importId,
    provider,
    externalRepo: repository.path,
    gitBaseUrl: new URL(repository.remoteUrl).origin,
    encryptedToken,
    expiresAt: new Date(Date.now() + IMPORT_PROXY_TTL_SECONDS * 1_000),
  });
  return proxyUrl(env, rawToken, requestUrl);
}

function importFailureMessage(error: unknown): string {
  if (isArtifactsErrorCode(error, "REMOTE_AUTH_REQUIRED")) {
    return "The provider requires authentication. Choose Private access and connect a token.";
  }
  if (isArtifactsErrorCode(error, "NOT_FOUND")) {
    return "The provider repository was not found or is not accessible";
  }
  if (isArtifactsErrorCode(error, "INVALID_URL")) {
    return "The provider repository URL is not a valid Git remote";
  }
  if (isArtifactsErrorCode(error, "UPSTREAM_UNAVAILABLE")) {
    return "The Git provider could not be reached";
  }
  if (isArtifactsErrorCode(error, "MEMORY_LIMIT")) {
    return "Cloudflare Artifacts ran out of memory importing the full Git history. Retry with depth 1; the complete source tree is still imported.";
  }
  if (isArtifactsErrorCode(error, "ALREADY_EXISTS")) {
    return "The import target already exists";
  }
  if (error instanceof AppError) return error.message;
  return "Import failed. Check provider access and try again.";
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "UNKNOWN";
}

export async function failProjectImport(
  db: Database,
  storage: GitStorage,
  env: Env,
  importId: string,
  message: string
): Promise<void> {
  const [job] = await db
    .select()
    .from(projectImports)
    .where(eq(projectImports.id, importId))
    .limit(1);
  if (!job || job.status === "ready" || job.status === "failed") return;

  const now = new Date();
  await db
    .update(projectImports)
    .set({
      status: "failed",
      error: message.slice(0, 500),
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(projectImports.id, importId));
  await db
    .delete(importProxySessions)
    .where(eq(importProxySessions.projectImportId, importId));

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, job.projectId))
    .limit(1);
  if (project && project.artifactsRepoName === job.artifactsRepoName) {
    await db
      .update(projects)
      .set({
        provisioningState: "failed",
        provisioningError: message.slice(0, 500),
        updatedAt: now,
      })
      .where(eq(projects.id, project.id));
  }

  await storage.deleteRepository(job.artifactsRepoName).catch(() => false);
  await recordEvent(db, {
    projectId: job.projectId,
    groupId: project?.groupId,
    actorId: job.requestedBy,
    action: "project.import_failed",
    targetType: "project",
    targetId: job.projectId,
    metadata: {
      provider: job.provider,
      externalRepo: job.externalRepo,
      error: message.slice(0, 300),
    },
  });
}

export async function finalizeProjectImport(
  db: Database,
  storage: GitStorage,
  env: Env,
  importId: string
): Promise<"ready" | "pending" | "failed"> {
  const [job] = await db
    .select()
    .from(projectImports)
    .where(eq(projectImports.id, importId))
    .limit(1);
  if (!job) return "failed";
  if (job.status === "ready") return "ready";
  if (job.status === "failed") return "failed";
  if (Date.now() - job.createdAt.getTime() > IMPORT_TIMEOUT_MS) {
    await failProjectImport(
      db,
      storage,
      env,
      importId,
      "Repository import timed out. Try again."
    );
    return "failed";
  }

  const checkedAt = new Date();
  await db
    .update(projectImports)
    .set({ lastCheckedAt: checkedAt })
    .where(eq(projectImports.id, importId));

  let info: ArtifactsRepoInfo;
  try {
    info = await storage.getRepositoryInfo(job.artifactsRepoName);
  } catch (error) {
    if (
      isArtifactsErrorCode(error, "IMPORT_IN_PROGRESS") ||
      isArtifactsErrorCode(error, "CREATE_IN_PROGRESS") ||
      isArtifactsErrorCode(error, "FORK_IN_PROGRESS")
    ) {
      return "pending";
    }
    if (
      isArtifactsErrorCode(error, "NOT_FOUND") ||
      isArtifactsErrorCode(error, "INVALID_URL")
    ) {
      await failProjectImport(
        db,
        storage,
        env,
        importId,
        importFailureMessage(error)
      );
      return "failed";
    }
    return "pending";
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, job.projectId))
    .limit(1);
  if (!project) {
    await failProjectImport(db, storage, env, importId, "Project not found");
    return "failed";
  }

  const previousRepoName = project.artifactsRepoName;
  const replacing = previousRepoName !== job.artifactsRepoName;
  const completedAt = new Date();

  if (replacing) {
    await writeBatch(db, [
      db.delete(gitSyncLeases).where(eq(gitSyncLeases.projectId, project.id)),
      db.delete(gitSyncRuns).where(eq(gitSyncRuns.projectId, project.id)),
      db.delete(gitRefs).where(eq(gitRefs.projectId, project.id)),
      db.delete(gitCommits).where(eq(gitCommits.projectId, project.id)),
      db
        .update(mergeRequests)
        .set({ state: "closed", closedAt: completedAt, updatedAt: completedAt })
        .where(
          and(
            eq(mergeRequests.projectId, project.id),
            eq(mergeRequests.state, "opened")
          )
        ),
      db
        .update(projects)
        .set({
          artifactsRepoName: job.artifactsRepoName,
          artifactsRemote: info.remote,
          defaultBranch: info.defaultBranch || project.defaultBranch,
          provisioningState: "ready",
          provisioningError: null,
          lastSyncedAt: null,
          updatedAt: completedAt,
        })
        .where(eq(projects.id, project.id)),
      db
        .update(projectImports)
        .set({
          status: "ready",
          error: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(projectImports.id, job.id)),
    ]);
  } else {
    await writeBatch(db, [
      db
        .update(projects)
        .set({
          artifactsRemote: info.remote,
          defaultBranch: info.defaultBranch || project.defaultBranch,
          provisioningState: "ready",
          provisioningError: null,
          updatedAt: completedAt,
        })
        .where(eq(projects.id, project.id)),
      db
        .update(projectImports)
        .set({
          status: "ready",
          error: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(projectImports.id, job.id)),
    ]);
  }

  await db
    .delete(importProxySessions)
    .where(eq(importProxySessions.projectImportId, job.id));

  if (replacing) {
    const previousProject = {
      ...project,
      artifactsRepoName: previousRepoName,
    };
    await revokeProjectTokens(db, storage, previousProject).catch(() => false);
    await storage.deleteRepository(previousRepoName).catch((error: unknown) => {
      console.warn("previous_import_repo_delete_failed", {
        projectId: project.id,
        code: errorCode(error),
      });
      return false;
    });
  }

  const [updated] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1);
  if (updated) {
    await refreshRepositoryRefs(db, storage, updated).catch(
      (error: unknown) => {
        console.warn("import_refresh_failed", {
          projectId: project.id,
          code: errorCode(error),
        });
      }
    );
  }

  await recordEvent(db, {
    projectId: project.id,
    groupId: project.groupId,
    actorId: job.requestedBy,
    action: replacing ? "project.reimported" : "project.imported",
    targetType: "project",
    targetId: project.id,
    metadata: {
      provider: job.provider,
      externalRepo: job.externalRepo,
      branch: job.branch,
    },
  });

  return "ready";
}

async function beginImport(
  db: Database,
  storage: GitStorage,
  env: Env,
  input: BeginImportInput
): Promise<ProjectImport> {
  if (input.repository.private) {
    assertProxyOrigin(env, input.requestUrl);
    if (!input.token) {
      throw conflict(
        `Connect your ${GIT_PROVIDER_LABELS[input.provider]} account to import a private repository`
      );
    }
  }

  let job: ProjectImport | undefined;
  try {
    [job] = await db
      .insert(projectImports)
      .values({
        projectId: input.project.id,
        provider: input.provider,
        externalRepo: input.repository.path,
        externalRepoId: input.repository.id,
        remoteUrl: input.repository.remoteUrl,
        repositoryPrivate: input.repository.private,
        branch: input.branch ?? null,
        depth: input.depth ?? null,
        status: "pending",
        artifactsRepoName: input.artifactsRepoName,
        previousRepoName: input.previousRepoName,
        requestedBy: input.requestedBy,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, "project_imports.project_id")) {
      throw conflict("An import is already running for this project");
    }
    throw error;
  }
  if (!job) throw new Error("Could not create import job");

  await recordAudit(db, {
    actorId: input.requestedBy,
    projectId: input.project.id,
    action: input.previousRepoName ? "project.reimport" : "project.import",
    detail: {
      provider: input.provider,
      externalRepo: input.repository.path,
      private: input.repository.private,
      branch: input.branch ?? null,
      depth: input.depth ?? null,
    },
  });

  try {
    const sourceUrl = input.repository.private
      ? await createProxySession(
          db,
          env,
          job.id,
          input.provider,
          input.repository,
          input.token!,
          input.requestUrl
        )
      : input.repository.remoteUrl;

    const created = await storage.importRepository(job.artifactsRepoName, {
      source: {
        url: sourceUrl,
        ...(input.branch ? { branch: input.branch } : {}),
        ...(input.depth ? { depth: input.depth } : {}),
      },
      target: {
        description:
          input.project.description ||
          `Imported from ${input.provider}: ${input.repository.path}`,
      },
    });
    await storage
      .revokeToken(job.artifactsRepoName, created.token)
      .catch(() => false);

    await db
      .update(projectImports)
      .set({ status: "importing", updatedAt: new Date() })
      .where(eq(projectImports.id, job.id));

    await finalizeProjectImport(db, storage, env, job.id).catch(
      (error: unknown) => {
        console.warn("import_finalize_failed", {
          importId: job.id,
          code: errorCode(error),
        });
      }
    );
  } catch (error) {
    await failProjectImport(
      db,
      storage,
      env,
      job.id,
      importFailureMessage(error)
    );
  }

  const [current] = await db
    .select()
    .from(projectImports)
    .where(eq(projectImports.id, job.id))
    .limit(1);
  return current ?? job;
}

function publicRepositoryStub(
  externalRepo: string,
  remoteUrl: string
): ProviderRepository {
  const name = externalRepo.split("/").at(-1) ?? externalRepo;
  return {
    id: externalRepo,
    path: externalRepo,
    name,
    defaultBranch: "main",
    private: false,
    remoteUrl,
    webUrl: remoteUrl.replace(/\.git$/, ""),
    updatedAt: null,
  };
}

interface ImportProjectFields {
  groupId: string;
  slug: string;
  name: string;
  description: string;
  visibility: "private" | "internal";
  branch?: string;
  depth?: number;
}

async function createWithResolvedRepository(
  db: Database,
  storage: GitStorage,
  env: ProviderEnv,
  creatorId: string,
  input: ImportProjectFields,
  provider: GitProvider,
  repository: ProviderRepository,
  token: string | undefined,
  requestUrl?: string
): Promise<{ project: Project; import: ProjectImport }> {
  const project = await createProjectShell(
    db,
    env,
    { id: creatorId },
    {
      groupId: input.groupId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      defaultBranch: repository.defaultBranch,
    }
  );
  const job = await beginImport(db, storage, env, {
    project,
    provider,
    repository,
    token,
    requestedBy: creatorId,
    branch: input.branch,
    depth: input.depth,
    artifactsRepoName: project.artifactsRepoName,
    previousRepoName: null,
    requestUrl,
  });
  const [updated] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, project.id))
    .limit(1);
  return { project: updated ?? project, import: job };
}

export async function createImportedProject(
  db: Database,
  storage: GitStorage,
  env: ProviderEnv,
  creatorId: string,
  input: CreateImportedProjectInput,
  token: string,
  requestUrl?: string
): Promise<{ project: Project; import: ProjectImport }> {
  const repository = await getProviderRepository(
    input.provider,
    token,
    env,
    input.externalRepo
  );
  return createWithResolvedRepository(
    db,
    storage,
    env,
    creatorId,
    input,
    input.provider,
    repository,
    token,
    requestUrl
  );
}

export async function createImportedProjectFromUrl(
  db: Database,
  storage: GitStorage,
  env: ProviderEnv,
  creatorId: string,
  input: CreateImportedProjectFromUrlInput,
  token?: string,
  requestUrl?: string
): Promise<{ project: Project; import: ProjectImport }> {
  const parsed = parseProviderRepositoryUrl(input.sourceUrl, env);
  let repository: ProviderRepository;
  if (input.repositoryVisibility === "public") {
    // Artifacts can fetch the public remote directly. This deliberately avoids
    // anonymous provider API rate limits for public imports.
    repository = publicRepositoryStub(parsed.externalRepo, parsed.remoteUrl);
  } else {
    if (!token) {
      throw conflict(
        `Connect your ${GIT_PROVIDER_LABELS[parsed.provider]} account to import a private repository`
      );
    }
    repository = await getProviderRepository(
      parsed.provider,
      token,
      env,
      parsed.externalRepo
    );
  }
  return createWithResolvedRepository(
    db,
    storage,
    env,
    creatorId,
    input,
    parsed.provider,
    repository,
    token,
    requestUrl
  );
}

export async function reimportProject(
  db: Database,
  storage: GitStorage,
  env: ProviderEnv,
  project: Project,
  requestedBy: string,
  token: string | undefined,
  options: { branch?: string; depth?: number; requestUrl?: string } = {}
): Promise<ProjectImport> {
  const last = await latestProjectImport(db, project.id);
  if (!last) {
    throw conflict("This project was not created from an external repository");
  }
  const active = await db
    .select({ id: projectImports.id })
    .from(projectImports)
    .where(
      and(
        eq(projectImports.projectId, project.id),
        inArray(projectImports.status, ["pending", "importing"])
      )
    )
    .limit(1);
  if (active.length > 0) {
    throw conflict("An import is already running for this project");
  }

  let repository: ProviderRepository;
  if (last.repositoryPrivate) {
    if (!token) {
      throw conflict(
        `Connect your ${GIT_PROVIDER_LABELS[last.provider]} account to re-import this private repository`
      );
    }
    repository = await getProviderRepository(
      last.provider,
      token,
      env,
      last.externalRepo
    );
  } else {
    repository = publicRepositoryStub(last.externalRepo, last.remoteUrl);
  }
  return beginImport(db, storage, env, {
    project,
    provider: last.provider,
    repository,
    token,
    requestedBy,
    branch: options.branch ?? last.branch ?? undefined,
    depth: options.depth ?? last.depth ?? undefined,
    artifactsRepoName: newArtifactsRepoName(),
    previousRepoName: project.artifactsRepoName,
    requestUrl: options.requestUrl,
  });
}

export async function pollProjectImport(
  db: Database,
  storage: GitStorage,
  env: Env,
  projectId: string
): Promise<ProjectImport | null> {
  const job = await latestProjectImport(db, projectId);
  if (!job) return null;
  if (job.status === "pending" || job.status === "importing") {
    const recent =
      job.lastCheckedAt && Date.now() - job.lastCheckedAt.getTime() < 2_000;
    if (!recent) {
      await finalizeProjectImport(db, storage, env, job.id).catch(
        (error: unknown) => {
          console.warn("import_status_check_failed", {
            importId: job.id,
            code: errorCode(error),
          });
        }
      );
    }
  }
  return latestProjectImport(db, projectId);
}

export async function reconcileProjectImports(
  db: Database,
  storage: GitStorage,
  env: Env
): Promise<void> {
  const jobs = await db
    .select({ id: projectImports.id })
    .from(projectImports)
    .where(inArray(projectImports.status, ["pending", "importing"]))
    .orderBy(projectImports.createdAt)
    .limit(10);
  for (const job of jobs) {
    await finalizeProjectImport(db, storage, env, job.id).catch(
      (error: unknown) => {
        console.warn("import_reconcile_failed", {
          importId: job.id,
          code: errorCode(error),
        });
      }
    );
  }
  await db
    .delete(importProxySessions)
    .where(lt(importProxySessions.expiresAt, new Date(Date.now() - 3_600_000)))
    .catch((error: unknown) => {
      console.warn("import_proxy_cleanup_failed", {
        code: errorCode(error),
      });
    });
}
