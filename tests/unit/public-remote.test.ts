import { describe, expect, it } from "vitest";
import { publicGitRemote } from "@worker/services/public-remote";

const account = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const app = "https://git.example.com";

describe("publicGitRemote", () => {
  it("moves Artifacts remotes onto the app origin and keeps the path", () => {
    expect(
      publicGitRemote(
        `https://${account}.artifacts.cloudflare.net/git/cloudflare-git/p-0123456789ab.git`,
        app
      )
    ).toBe(`${app}/git/cloudflare-git/p-0123456789ab.git`);
  });

  it("leaves fake and non-Artifacts remotes alone", () => {
    expect(
      publicGitRemote(
        "https://fake-artifacts.local/git/cloudflare-git/p-0123456789ab.git",
        app
      )
    ).toBe(
      "https://fake-artifacts.local/git/cloudflare-git/p-0123456789ab.git"
    );
    expect(publicGitRemote("https://github.com/owner/repo.git", app)).toBe(
      "https://github.com/owner/repo.git"
    );
  });

  it("keeps null and malformed remotes unchanged", () => {
    expect(publicGitRemote(null, app)).toBeNull();
    expect(publicGitRemote("not a url", app)).toBe("not a url");
  });

  it("does not rewrite when the app URL is invalid", () => {
    const remote =
      "https://acct.artifacts.cloudflare.net/git/cloudflare-git/p-0123456789ab.git";
    expect(publicGitRemote(remote, "not a url")).toBe(remote);
  });
});
