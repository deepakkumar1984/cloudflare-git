import { describe, expect, it } from "vitest";
import { validatePath, validateRef } from "@worker/services/repository";

describe("repository path validation", () => {
  it("normalizes root and trims surrounding slashes", () => {
    expect(validatePath("")).toBe("");
    expect(validatePath("/")).toBe("");
    expect(validatePath("/src/lib/")).toBe("src/lib");
  });

  it("rejects traversal and ambiguous paths", () => {
    for (const value of [
      "../secret",
      "src/../secret",
      "src//lib",
      "./src",
      "src\\lib",
      "src/\u0000/lib",
      "src/lib/..",
    ]) {
      expect(() => validatePath(value)).toThrow();
    }
  });

  it("accepts normal branch and tag references", () => {
    expect(validateRef("main")).toBe("main");
    expect(validateRef("feature/hello-world")).toBe("feature/hello-world");
    expect(validateRef("refs/heads/release/1.0")).toBe(
      "refs/heads/release/1.0"
    );
  });

  it("rejects unsafe or malformed references", () => {
    for (const value of [
      "",
      "..",
      "feature/../main",
      "/absolute",
      "trailing/",
      "bad ref",
      "bad~ref",
      "bad:ref",
      "bad?ref",
      "bad*ref",
      "bad\\ref",
      "bad\u0000ref",
      "branch.lock",
      "branch.",
      "refs//heads/main",
      "branch@{1}",
    ]) {
      expect(() => validateRef(value)).toThrow();
    }
  });

  it("caps the number of path segments", () => {
    expect(() =>
      validatePath(Array.from({ length: 51 }, () => "a").join("/"))
    ).toThrow();
  });
});
