import { eq } from "drizzle-orm";
import type { Database } from "@db/client";
import {
  boardLists,
  boards,
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
  type Visibility,
} from "@shared/constants";
import type { GitStorage } from "@worker/artifacts";
import { isArtifactsErrorCode } from "@worker/artifacts/types";
import { recordEvent } from "./events";

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

  const project = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(projects)
      .values({
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
      .returning();
    if (!created) throw new Error("Could not create project");

    await tx.insert(projectMembers).values({
      projectId: created.id,
      userId: creator.id,
      role: "maintainer",
    });
    await tx.insert(projectCounters).values({ projectId: created.id });
    const createdLabels = await tx
      .insert(labels)
      .values(
        BOARD_DEFAULT_LISTS.map((label) => ({
          projectId: created.id,
          title: label.name,
          color: label.color,
        }))
      )
      .returning();
    const [board] = await tx
      .insert(boards)
      .values({ projectId: created.id })
      .returning();
    if (board) {
      await tx.insert(boardLists).values(
        createdLabels.map((label, index) => ({
          boardId: board.id,
          labelId: label.id,
          name: label.title,
          position: index,
        }))
      );
    }
    return created;
  });

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
  return provisionProject(db, storage, project);
}

/**
 * Idempotently creates or reconnects the Artifacts repository for a project.
 * The project row exists first so failures are visible and retryable.
 */
export async function provisionProject(
  db: Database,
  storage: GitStorage,
  project: Project
): Promise<Project> {
  if (project.provisioningState === "ready" && project.artifactsRemote) {
    return project;
  }

  let remote: string;
  let initialToken: string | null = null;
  try {
    const created = await storage.createRepository(project.artifactsRepoName, {
      description: project.description || `Deesha Git project ${project.name}`,
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

export function projectVisibilityAllowed(
  group: Pick<Group, "visibility">,
  projectVisibility: Visibility
): boolean {
  return !(group.visibility === "private" && projectVisibility === "internal");
}
