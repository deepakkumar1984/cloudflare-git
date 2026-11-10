import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@db/client";
import { gitTokenGrants, projects, type Project } from "@db/schema";
import { GIT_TOKEN_TTL_SECONDS } from "@shared/constants";
import type { GitStorage } from "@worker/artifacts";
import { conflict } from "@worker/lib/errors";
import { recordAudit } from "./events";

export interface GitCredentials {
  remote: string;
  username: string;
  token: string;
  scope: "read" | "write";
  expiresAt: string;
}

async function revokeGrant(
  db: Database,
  storage: GitStorage,
  grant: {
    id: string;
    projectId: string;
    artifactsTokenId: string;
  },
  repoName: string
): Promise<boolean> {
  const revoked = await storage
    .revokeToken(repoName, grant.artifactsTokenId)
    .catch(() => false);
  if (revoked) {
    await db
      .update(gitTokenGrants)
      .set({ revokedAt: new Date() })
      .where(eq(gitTokenGrants.id, grant.id));
  }
  return revoked;
}

export async function mintGitCredentials(
  db: Database,
  storage: GitStorage,
  project: Project,
  userId: string,
  scope: "read" | "write",
  ipAddress?: string | null
): Promise<GitCredentials> {
  if (project.provisioningState !== "ready" || !project.artifactsRemote) {
    throw conflict("Repository is not ready");
  }

  const previous = await db
    .select({
      id: gitTokenGrants.id,
      projectId: gitTokenGrants.projectId,
      artifactsTokenId: gitTokenGrants.artifactsTokenId,
    })
    .from(gitTokenGrants)
    .where(
      and(
        eq(gitTokenGrants.projectId, project.id),
        eq(gitTokenGrants.userId, userId),
        eq(gitTokenGrants.scope, scope),
        isNull(gitTokenGrants.revokedAt)
      )
    );
  for (const grant of previous) {
    await revokeGrant(db, storage, grant, project.artifactsRepoName);
  }

  const token = await storage.createToken(
    project.artifactsRepoName,
    scope,
    GIT_TOKEN_TTL_SECONDS
  );

  try {
    await db.insert(gitTokenGrants).values({
      projectId: project.id,
      userId,
      artifactsTokenId: token.id,
      scope,
      expiresAt: new Date(token.expiresAt),
    });
  } catch (error) {
    await storage
      .revokeToken(project.artifactsRepoName, token.id)
      .catch(() => false);
    throw error;
  }

  await recordAudit(db, {
    actorId: userId,
    projectId: project.id,
    action: "git_token.issued",
    detail: { scope, tokenId: token.id, expiresAt: token.expiresAt },
    ipAddress,
  });

  return {
    remote: project.artifactsRemote,
    username: "x",
    token: token.plaintext,
    scope,
    expiresAt: token.expiresAt,
  };
}

export async function revokeUserProjectTokens(
  db: Database,
  storage: GitStorage,
  project: Pick<Project, "id" | "artifactsRepoName">,
  userId: string,
  scope?: "read" | "write"
): Promise<void> {
  const grants = await db
    .select({
      id: gitTokenGrants.id,
      projectId: gitTokenGrants.projectId,
      artifactsTokenId: gitTokenGrants.artifactsTokenId,
    })
    .from(gitTokenGrants)
    .where(
      and(
        eq(gitTokenGrants.projectId, project.id),
        eq(gitTokenGrants.userId, userId),
        isNull(gitTokenGrants.revokedAt),
        ...(scope ? [eq(gitTokenGrants.scope, scope)] : [])
      )
    );
  for (const grant of grants) {
    await revokeGrant(db, storage, grant, project.artifactsRepoName);
  }
}

export async function revokeUserGroupTokens(
  db: Database,
  storage: GitStorage,
  groupId: string,
  userId: string
): Promise<void> {
  const grants = await db
    .select({
      id: gitTokenGrants.id,
      projectId: gitTokenGrants.projectId,
      artifactsTokenId: gitTokenGrants.artifactsTokenId,
      repoName: projects.artifactsRepoName,
    })
    .from(gitTokenGrants)
    .innerJoin(projects, eq(gitTokenGrants.projectId, projects.id))
    .where(
      and(
        eq(projects.groupId, groupId),
        eq(gitTokenGrants.userId, userId),
        isNull(gitTokenGrants.revokedAt)
      )
    );
  for (const grant of grants) {
    await revokeGrant(db, storage, grant, grant.repoName);
  }
}

export async function revokeProjectTokens(
  db: Database,
  storage: GitStorage,
  project: Pick<Project, "id" | "artifactsRepoName">
): Promise<void> {
  const grants = await db
    .select({
      id: gitTokenGrants.id,
      projectId: gitTokenGrants.projectId,
      artifactsTokenId: gitTokenGrants.artifactsTokenId,
    })
    .from(gitTokenGrants)
    .where(
      and(
        eq(gitTokenGrants.projectId, project.id),
        isNull(gitTokenGrants.revokedAt)
      )
    );
  for (const grant of grants) {
    await revokeGrant(db, storage, grant, project.artifactsRepoName);
  }
}

export async function revokeGroupTokens(
  db: Database,
  storage: GitStorage,
  groupId: string
): Promise<void> {
  const grants = await db
    .select({
      id: gitTokenGrants.id,
      projectId: gitTokenGrants.projectId,
      artifactsTokenId: gitTokenGrants.artifactsTokenId,
      repoName: projects.artifactsRepoName,
    })
    .from(gitTokenGrants)
    .innerJoin(projects, eq(gitTokenGrants.projectId, projects.id))
    .where(
      and(eq(projects.groupId, groupId), isNull(gitTokenGrants.revokedAt))
    );
  for (const grant of grants) {
    await revokeGrant(db, storage, grant, grant.repoName);
  }
}
