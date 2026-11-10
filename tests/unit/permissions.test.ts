import { describe, expect, it } from "vitest";
import {
  atLeast,
  canCreateIssue,
  canDeleteNote,
  canEditIssue,
  canMarkMerged,
  canReview,
  canViewConfidential,
  canViewProject,
  canWriteGit,
  effectiveRole,
  maxRole,
} from "@shared/permissions";

describe("permission helpers", () => {
  it("ranks roles in order and treats missing roles as no access", () => {
    expect(atLeast("owner", "developer")).toBe(true);
    expect(atLeast("guest", "reporter")).toBe(false);
    expect(atLeast(null, "guest")).toBe(false);
    expect(maxRole("guest", "maintainer", null)).toBe("maintainer");
  });

  it("resolves an effective role from project, group, and admin", () => {
    expect(
      effectiveRole({ projectRole: "reporter", groupRole: "developer" })
    ).toBe("developer");
    expect(effectiveRole({ groupRole: "guest", isAdmin: true })).toBe("owner");
    expect(effectiveRole({})).toBeNull();
  });

  it("gates internal projects on authentication and private projects on role", () => {
    expect(canViewProject(null, "private", true)).toBe(false);
    expect(canViewProject(null, "internal", false)).toBe(false);
    expect(canViewProject(null, "internal", true)).toBe(true);
    expect(canViewProject("guest", "private", true)).toBe(true);
  });

  it("applies capability thresholds", () => {
    expect(canCreateIssue("guest")).toBe(false);
    expect(canCreateIssue("reporter")).toBe(true);
    expect(canWriteGit("reporter")).toBe(false);
    expect(canWriteGit("developer")).toBe(true);
    expect(canReview("reporter")).toBe(false);
    expect(canReview("developer")).toBe(true);
    expect(canMarkMerged("developer")).toBe(false);
    expect(canMarkMerged("maintainer")).toBe(true);
    expect(canViewConfidential("guest")).toBe(false);
    expect(canViewConfidential("reporter")).toBe(true);
  });

  it("lets reporters edit their own issues but not someone else's", () => {
    expect(canEditIssue("reporter", true)).toBe(true);
    expect(canEditIssue("reporter", false)).toBe(false);
    expect(canEditIssue("developer", false)).toBe(true);
    expect(canEditIssue("guest", true)).toBe(false);
  });

  it("lets authors delete their own notes, with maintainers overriding", () => {
    expect(canDeleteNote("guest", true)).toBe(true);
    expect(canDeleteNote("guest", false)).toBe(false);
    expect(canDeleteNote("maintainer", false)).toBe(true);
  });
});
