import { eq } from "drizzle-orm";
import type { Database } from "@db/client";
import {
  boardLists,
  boards,
  groups,
  labels,
  projectCounters,
  projectMembers,
  projects,
  type Group,
  type Project,
  type User,
} from "@db/schema";
import {
  BOARD_DEFAULT_LISTS,
  DEFAULT_BRANCH,
  configuredAppName,
  type Visibility,
} from "@shared/constants";
import type { GitStorage } from "@worker/artifacts";
import { isArtifactsErrorCode } from "@worker/artifacts/types";
import { recordEvent } from "./events";
import { revokeProjectTokens } from "./git-tokens";

export function newArtifactsRepoName(): string {
  return `p-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export interface CreateProjectInput {
  groupId: string;
  slug: string;
  name: string;
  description: string;
  visibility: Visibility;
  defaultBranch: string;
}

export async function createProjectShell(
  db: Database,
  env: Env,
  creator: Pick<User, "id">,
  input: CreateProjectInput
): Promise<Project> {
  const artifactsRepoName = newArtifactsRepoName();
  const artifactsNamespace = env.ARTIFACTS_NAMESPACE;
  const projectId = crypto.randomUUID();
  const labelRows = BOARD_DEFAULT_LISTS.map((label) => ({
    id: crypto.randomUUID(),
    projectId,
    title: label.name,
    color: label.color,
  }));
  const boardId = crypto.randomUUID();

  const [createdRows] = await db.batch([
    db
      .insert(projects)
      .values({
        id: projectId,
        groupId: input.groupId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        defaultBranch: input.defaultBranch || DEFAULT_BRANCH,
        artifactsNamespace,
        artifactsRepoName,
        createdBy: creator.id,
      })
      .returning(),
    db.insert(projectMembers).values({
      projectId,
      userId: creator.id,
      role: "maintainer",
    }),
    db.insert(projectCounters).values({ projectId }),
    db.insert(labels).values(labelRows),
    db.insert(boards).values({ id: boardId, projectId }),
    db.insert(boardLists).values(
      labelRows.map((label, index) => ({
        boardId,
        labelId: label.id,
        name: label.title,
        position: index,
      }))
    ),
  ]);
  const project = createdRows[0];
  if (!project) throw new Error("Could not create project");

  await recordEvent(db, {
    projectId: project.id,
    groupId: project.groupId,
    actorId: creator.id,
    action: "project.created",
    targetType: "project",
    targetId: project.id,
    metadata: { name: project.name },
  });

  return project;
}

export async function createProject(
  db: Database,
  storage: GitStorage,
  env: Env,
  creator: Pick<User, "id">,
  input: CreateProjectInput
): Promise<Project> {
  const project = await createProjectShell(db, env, creator, input);
  return provisionProject(
    db,
    storage,
    project,
    configuredAppName(env.APP_NAME)
  );
}

/**
 * Idempotently creates or reconnects the Artifacts repository for a project.
 * The project row exists first so failures are visible and retryable.
 */
export async function provisionProject(
  db: Database,
  storage: GitStorage,
  project: Project,
  appName = configuredAppName(undefined)
): Promise<Project> {
  if (project.provisioningState === "ready" && project.artifactsRemote) {
    return project;
  }

  let remote: string;
  let initialToken: string | null = null;
  try {
    const created = await storage.createRepository(project.artifactsRepoName, {
      description: project.description || `${appName} project ${project.name}`,
      setDefaultBranch: project.defaultBranch || DEFAULT_BRANCH,
    });
    remote = created.remote;
    initialToken = created.token;
  } catch (error) {
    if (isArtifactsErrorCode(error, "ALREADY_EXISTS")) {
      const info = await storage.getRepositoryInfo(project.artifactsRepoName);
      remote = info.remote;
    } else {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : String(error);
      const [failed] = await db
        .update(projects)
        .set({
          provisioningState: "failed",
          provisioningError: message,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id))
        .returning();
      return failed ?? project;
    }
  }

  if (initialToken) {
    await storage
      .revokeToken(project.artifactsRepoName, initialToken)
      .catch(() => false);
  }

  const [ready] = await db
    .update(projects)
    .set({
      artifactsRemote: remote,
      provisioningState: "ready",
      provisioningError: null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id))
    .returning();
  return ready ?? project;
}

async function removeRepository(
  storage: GitStorage,
  repoName: string
): Promise<void> {
  await storage.deleteRepository(repoName).catch(() => false);
}

/** Removes the Git repository and every row that belongs to the project. */
export async function deleteStoredProject(
  db: Database,
  storage: GitStorage,
  project: Pick<Project, "id" | "artifactsRepoName">
): Promise<void> {
  await revokeProjectTokens(db, storage, project);
  await removeRepository(storage, project.artifactsRepoName);
  await db.delete(projects).where(eq(projects.id, project.id));
}

/** Removes every project in the group, then the group itself. */
export async function deleteStoredGroup(
  db: Database,
  storage: GitStorage,
  groupId: string
): Promise<void> {
  const rows = await db
    .select({
      id: projects.id,
      artifactsRepoName: projects.artifactsRepoName,
    })
    .from(projects)
    .where(eq(projects.groupId, groupId));
  for (const project of rows) {
    await revokeProjectTokens(db, storage, project);
    await removeRepository(storage, project.artifactsRepoName);
  }
  await db.delete(groups).where(eq(groups.id, groupId));
}

export function projectVisibilityAllowed(
  group: Pick<Group, "visibility">,
  projectVisibility: Visibility
): boolean {
  return !(group.visibility === "private" && projectVisibility === "internal");
}
