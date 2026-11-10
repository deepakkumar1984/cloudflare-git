import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@db/client";
import {
  confidentialProjectIds,
  viewableProjectIds,
} from "@worker/services/access";
import {
  closeTestDatabase,
  getTestDatabase,
  resetDatabase,
} from "../helpers/db";
import {
  addGroupMember,
  addProjectMember,
  createGroup,
  createProject,
  createUser,
  sessionFor,
} from "../helpers/fixtures";

let db: Database;

beforeEach(async () => {
  await resetDatabase();
  db = (await getTestDatabase()).db;
});

afterAll(async () => {
  await closeTestDatabase();
});

describe("permission-filtered project lists", () => {
  it("returns direct, inherited, and internal projects; confidential only for reporter+", async () => {
    const owner = await createUser(db, { name: "Owner" });
    const reporter = await createUser(db, { name: "Reporter" });
    const guest = await createUser(db, { name: "Guest" });
    const admin = await createUser(db, { name: "Admin", isAdmin: true });

    const privateGroup = await createGroup(db, owner.id);
    const directProject = await createProject(db, {
      group: privateGroup,
      creatorId: owner.id,
      name: "Direct project",
    });
    const hiddenProject = await createProject(db, {
      group: privateGroup,
      creatorId: owner.id,
      name: "Hidden project",
    });
    await addProjectMember(db, directProject.id, reporter.id, "reporter");
    await addProjectMember(db, hiddenProject.id, guest.id, "guest");

    const internalGroup = await createGroup(db, owner.id, {
      visibility: "internal",
    });
    const internalProject = await createProject(db, {
      group: internalGroup,
      creatorId: owner.id,
      visibility: "internal",
      name: "Internal project",
    });
    await addGroupMember(db, internalGroup.id, reporter.id, "reporter");

    const reporterIds = await viewableProjectIds(db, sessionFor(reporter));
    expect(new Set(reporterIds)).toEqual(
      new Set([directProject.id, internalProject.id])
    );
    expect(
      new Set(await confidentialProjectIds(db, sessionFor(reporter)))
    ).toEqual(new Set([directProject.id, internalProject.id]));

    const guestIds = await viewableProjectIds(db, sessionFor(guest));
    expect(new Set(guestIds)).toEqual(
      new Set([hiddenProject.id, internalProject.id])
    );
    expect(await confidentialProjectIds(db, sessionFor(guest))).toEqual([]);

    const adminVisible = await viewableProjectIds(db, sessionFor(admin));
    expect(new Set(adminVisible)).toEqual(
      new Set([directProject.id, hiddenProject.id, internalProject.id])
    );
    expect(
      new Set(await confidentialProjectIds(db, sessionFor(admin)))
    ).toEqual(
      new Set([directProject.id, hiddenProject.id, internalProject.id])
    );
  });

  it("returns nothing for an anonymous viewer", async () => {
    await expect(viewableProjectIds(db, null)).resolves.toEqual([]);
    await expect(confidentialProjectIds(db, null)).resolves.toEqual([]);
  });
});
