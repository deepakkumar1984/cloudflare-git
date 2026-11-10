import { and, eq } from "drizzle-orm";
import type { Database } from "@db/client";
import { groupMembers, groups, type Group, type User } from "@db/schema";
import { isReservedSlug, slugify } from "@shared/slugs";

type Person = Pick<User, "id" | "email" | "name" | "username">;

function baseSlug(person: Person): string {
  const raw =
    person.username ||
    person.email.split("@")[0] ||
    `user-${person.id.slice(0, 8)}`;
  const slug = slugify(raw, 50);
  if (slug.length < 2 || isReservedSlug(slug)) {
    return `u-${person.id.slice(0, 12)}`;
  }
  return slug;
}

/**
 * Idempotently creates the personal group that owns a user's personal projects.
 * Personal groups are always private, cannot be archived, and have the user as owner.
 */
export async function ensurePersonalGroup(
  db: Database,
  person: Person
): Promise<Group> {
  const [existing] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.createdBy, person.id), eq(groups.personal, true)))
    .limit(1);
  if (existing) return existing;

  const base = baseSlug(person);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.slug, slug))
      .limit(1);
    if (taken) continue;

    try {
      return await db.transaction(async (tx) => {
        const [group] = await tx
          .insert(groups)
          .values({
            slug,
            name: person.name || person.username || "Personal",
            description: `Personal projects for ${person.username || person.email}`,
            visibility: "private",
            personal: true,
            createdBy: person.id,
          })
          .returning();
        if (!group) throw new Error("Could not create personal group");
        await tx.insert(groupMembers).values({
          groupId: group.id,
          userId: person.id,
          role: "owner",
        });
        return group;
      });
    } catch (error) {
      // A concurrent signup may have taken the slug; try the next suffix.
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("groups_slug_uq") ||
        message.includes("duplicate key")
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not allocate a personal group slug");
}
