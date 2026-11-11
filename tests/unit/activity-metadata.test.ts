import { describe, expect, it } from "vitest";
import { presentActivityMetadata } from "@worker/services/events";

describe("activity metadata", () => {
  it("drops push details and import paths from viewers who cannot read code", () => {
    expect(
      presentActivityMetadata(
        "push",
        {
          title: "hidden",
          ref: "refs/heads/main",
          after: "abc",
          unverifiedAuthor: { name: "Ada", email: "ada@example.com" },
          commitCount: 2,
        },
        false
      )
    ).toEqual({ commitCount: 2 });

    expect(
      presentActivityMetadata(
        "project.imported",
        { externalRepo: "acme/secret", provider: "github" },
        false
      )
    ).toEqual({ provider: "github" });
  });

  it("keeps repository details for reporters and still drops titles", () => {
    expect(
      presentActivityMetadata(
        "push",
        { title: "Issue title", ref: "refs/heads/main", commitCount: 1 },
        true
      )
    ).toEqual({ ref: "refs/heads/main", commitCount: 1 });
  });
});
