import { describe, expect, it } from "vitest";
import { publicGitRemote } from "@worker/services/public-remote";

describe("publicGitRemote", () => {
  it("moves Artifacts remotes onto the app origin and keeps the path", () => {
    expect(
      publicGitRemote(
        "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.artifacts.cloudflare.net/git/deesha-git/p-0123456789ab.git",
        "https://git.deesha.tech"
      )
    ).toBe("https://git.deesha.tech/git/deesha-git/p-0123456789ab.git");
  });

  it("leaves fake and non-Artifacts remotes alone", () => {
    expect(
      publicGitRemote(
        "https://fake-artifacts.local/git/deesha-git/p-0123456789ab.git",
        "https://git.deesha.tech"
      )
    ).toBe("https://fake-artifacts.local/git/deesha-git/p-0123456789ab.git");
    expect(
      publicGitRemote(
        "https://github.com/owner/repo.git",
        "https://git.deesha.tech"
      )
    ).toBe("https://github.com/owner/repo.git");
  });

  it("keeps null and malformed remotes unchanged", () => {
    expect(publicGitRemote(null, "https://git.deesha.tech")).toBeNull();
    expect(publicGitRemote("not a url", "https://git.deesha.tech")).toBe(
      "not a url"
    );
  });

  it("does not rewrite when the app URL is invalid", () => {
    const remote =
      "https://acct.artifacts.cloudflare.net/git/deesha-git/p-0123456789ab.git";
    expect(publicGitRemote(remote, "not a url")).toBe(remote);
  });
});
