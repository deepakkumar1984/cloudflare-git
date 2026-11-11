import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { releases, user } from "@db/schema";
import { releaseCreateSchema, releaseUpdateSchema } from "@shared/schemas";
import { canManageReleases } from "@shared/permissions";
import type { AppEnv } from "@worker/env";
import { getGitStorage } from "@worker/artifacts";
import { getTags } from "@worker/services/repository";
import {
  assertAuthenticated,
  assertProjectWritable,
  assertRole,
  loadProject,
} from "@worker/services/access";
import { recordEvent } from "@worker/services/events";
import {
  conflict,
  isUniqueViolation,
  notFound,
  readJson,
} from "@worker/lib/errors";

export const releaseRoutes = new Hono<AppEnv>();

const base = "/groups/:groupSlug/projects/:projectSlug/releases";

interface TagInfo {
  name: string;
  sha: string | null;
  committedAt: string | null;
  exists: boolean;
}

async function tagMap(
  db: AppEnv["Variables"]["db"],
  storage: ReturnType<typeof getGitStorage>,
  project: AppEnv["Variables"]["project"]
): Promise<Map<string, TagInfo>> {
  const tags = await getTags(db, storage, project);
  return new Map(
    tags.map((tag) => [
      tag.name,
      {
        name: tag.name,
        sha: tag.sha,
        committedAt: tag.commit?.committedAt ?? null,
        exists: true,
      },
    ])
  );
}

function authorView(row: typeof user.$inferSelect | null) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    displayUsername: row.displayUsername,
    image: row.image,
  };
}

releaseRoutes.get(base, loadProject, async (c) => {
  const project = c.get("project");
  const db = c.get("db");
  const rows = await db
    .select({ release: releases, author: user })
    .from(releases)
    .leftJoin(user, eq(releases.authorId, user.id))
    .where(eq(releases.projectId, project.id))
    .orderBy(desc(releases.createdAt));
  const tags = await tagMap(db, getGitStorage(c.env), project);
  return c.json({
    releases: rows.map((row) => ({
      ...row.release,
      author: authorView(row.author),
      tag: tags.get(row.release.tagName) ?? {
        name: row.release.tagName,
        sha: null,
        committedAt: null,
        exists: false,
      },
    })),
    canManage: canManageReleases(c.get("role")),
  });
});

releaseRoutes.get(`${base}/:releaseId`, loadProject, async (c) => {
  const project = c.get("project");
  const db = c.get("db");
  const [row] = await db
    .select({ release: releases, author: user })
    .from(releases)
    .leftJoin(user, eq(releases.authorId, user.id))
    .where(
      and(
        eq(releases.id, c.req.param("releaseId")),
        eq(releases.projectId, project.id)
      )
    );
  if (!row) throw notFound("Release not found");
  const tags = await tagMap(db, getGitStorage(c.env), project);
  return c.json({
    release: {
      ...row.release,
      author: authorView(row.author),
      tag: tags.get(row.release.tagName) ?? {
        name: row.release.tagName,
        sha: null,
        committedAt: null,
        exists: false,
      },
    },
  });
});

releaseRoutes.post(base, loadProject, async (c) => {
  assertRole(c, "maintainer");
  assertProjectWritable(c);
  const session = assertAuthenticated(c);
  const project = c.get("project");
  const db = c.get("db");
  const input = await readJson(c, releaseCreateSchema);

  const tags = await tagMap(db, getGitStorage(c.env), project);
  if (!tags.has(input.tagName)) {
    throw conflict(
      `Tag ${input.tagName} does not exist. Push it with git tag and git push --tags, then refresh the repository.`
    );
  }

  try {
    const [release] = await db
      .insert(releases)
      .values({
        projectId: project.id,
        tagName: input.tagName,
        title: input.title,
        description: input.description,
        authorId: session.user.id,
      })
      .returning();
    await recordEvent(db, {
      projectId: project.id,
      actorId: session.user.id,
      action: "release.created",
      targetType: "release",
      targetId: release!.id,
      metadata: { tagName: input.tagName, title: input.title },
    });
    return c.json(
      {
        release: {
          ...release,
          author: authorView(null),
          tag: tags.get(input.tagName)!,
        },
      },
      201
    );
  } catch (error) {
    if (isUniqueViolation(error, "releases.project_id, releases.tag_name")) {
      throw conflict("A release already exists for this tag");
    }
    throw error;
  }
});

releaseRoutes.patch(`${base}/:releaseId`, loadProject, async (c) => {
  assertRole(c, "maintainer");
  assertProjectWritable(c);
  const session = assertAuthenticated(c);
  const project = c.get("project");
  const db = c.get("db");
  const input = await readJson(c, releaseUpdateSchema);
  const [release] = await db
    .update(releases)
    .set({
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(releases.id, c.req.param("releaseId")),
        eq(releases.projectId, project.id)
      )
    )
    .returning();
  if (!release) throw notFound("Release not found");
  await recordEvent(db, {
    projectId: project.id,
    actorId: session.user.id,
    action: "release.updated",
    targetType: "release",
    targetId: release.id,
    metadata: { tagName: release.tagName, title: release.title },
  });
  const tags = await tagMap(db, getGitStorage(c.env), project);
  return c.json({
    release: {
      ...release,
      author: null,
      tag: tags.get(release.tagName) ?? {
        name: release.tagName,
        sha: null,
        committedAt: null,
        exists: false,
      },
    },
  });
});

releaseRoutes.delete(`${base}/:releaseId`, loadProject, async (c) => {
  assertRole(c, "maintainer");
  assertProjectWritable(c);
  const session = assertAuthenticated(c);
  const project = c.get("project");
  const db = c.get("db");
  const deleted = await db
    .delete(releases)
    .where(
      and(
        eq(releases.id, c.req.param("releaseId")),
        eq(releases.projectId, project.id)
      )
    )
    .returning();
  if (deleted.length === 0) throw notFound("Release not found");
  await recordEvent(db, {
    projectId: project.id,
    actorId: session.user.id,
    action: "release.deleted",
    targetType: "release",
    targetId: deleted[0]!.id,
    metadata: { tagName: deleted[0]!.tagName },
  });
  return c.body(null, 204);
});
