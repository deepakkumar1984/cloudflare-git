import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProviderRepository,
  listProviderRepositories,
  parseProviderRepositoryUrl,
  providerGitAuthorization,
  providerRemoteUrl,
  validateExternalRepo,
  validateProviderToken,
  type ProviderEnv,
} from "@worker/services/git-providers";
import {
  decryptProviderToken,
  encryptProviderToken,
  providerTokenSecret,
} from "@worker/services/token-vault";

const env = {
  GITLAB_BASE_URL: "https://gitlab.example.com",
} as ProviderEnv;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider token encryption", () => {
  it("uses a dedicated key with an auth-secret fallback", () => {
    const authSecret = "auth-secret-".repeat(3);
    expect(
      providerTokenSecret({
        BETTER_AUTH_SECRET: authSecret,
        PROVIDER_TOKEN_KEY: "provider-key-".repeat(3),
      })
    ).toBe("provider-key-".repeat(3));
    expect(
      providerTokenSecret({
        BETTER_AUTH_SECRET: authSecret,
        ENVIRONMENT: "development",
      })
    ).toBe(authSecret);
    expect(() =>
      providerTokenSecret({ BETTER_AUTH_SECRET: authSecret })
    ).toThrow(/PROVIDER_TOKEN_KEY/);
    expect(() =>
      providerTokenSecret({
        BETTER_AUTH_SECRET: authSecret,
        PROVIDER_TOKEN_KEY: "short",
      })
    ).toThrow();
  });

  it("round-trips tokens without storing plaintext", async () => {
    const secret = "unit-secret-".repeat(4);
    const token = "ghp_super_secret_token_value";
    const first = await encryptProviderToken(secret, token);
    const second = await encryptProviderToken(secret, token);

    expect(first).not.toContain(token);
    expect(first).not.toBe(second);
    await expect(decryptProviderToken(secret, first)).resolves.toBe(token);
    await expect(
      decryptProviderToken("different-secret-".repeat(3), first)
    ).rejects.toThrow();
  });

  it("rejects tampered envelopes", async () => {
    const secret = "unit-secret-".repeat(4);
    const envelope = await encryptProviderToken(secret, "token-123");
    const parts = envelope.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}AA`;
    await expect(decryptProviderToken(secret, tampered)).rejects.toThrow();
    await expect(decryptProviderToken(secret, "v2.bad.bad")).rejects.toThrow();
  });
});

describe("provider Git authentication", () => {
  it("uses Basic auth for GitHub and GitLab Git endpoints", () => {
    expect(providerGitAuthorization("github", "abc")).toBe(
      `Basic ${btoa("x-access-token:abc")}`
    );
    expect(providerGitAuthorization("gitlab", "abc")).toBe(
      `Basic ${btoa("oauth2:abc")}`
    );
  });

  it("parses browser and clone URLs into provider remotes", () => {
    expect(
      parseProviderRepositoryUrl(
        "https://github.com/Owner/Repo.git?tab=readme",
        env
      )
    ).toEqual({
      provider: "github",
      externalRepo: "Owner/Repo",
      remoteUrl: "https://github.com/Owner/Repo.git",
    });
    expect(
      parseProviderRepositoryUrl(
        "https://gitlab.example.com/group/sub/project/",
        env
      )
    ).toEqual({
      provider: "gitlab",
      externalRepo: "group/sub/project",
      remoteUrl: "https://gitlab.example.com/group/sub/project.git",
    });

    for (const value of [
      "http://github.com/owner/repo",
      "https://user:secret@github.com/owner/repo",
      "https://github.com/owner/repo/tree/main",
      "https://gitlab.example.com/group/project/-/tree/main",
      "https://example.com/owner/repo",
      "not-a-url",
    ]) {
      expect(() => parseProviderRepositoryUrl(value, env)).toThrow();
    }
  });

  it("validates provider repository paths and canonical remotes", () => {
    expect(validateExternalRepo("github", "owner/repo")).toBe("owner/repo");
    expect(() => validateExternalRepo("github", "owner/repo/extra")).toThrow();
    expect(() => validateExternalRepo("github", "../repo")).toThrow();
    expect(() =>
      validateExternalRepo("gitlab", "group/sub/project")
    ).not.toThrow();
    expect(providerRemoteUrl("github", "owner/repo", env)).toBe(
      "https://github.com/owner/repo.git"
    );
    expect(providerRemoteUrl("gitlab", "group/sub/project", env)).toBe(
      "https://gitlab.example.com/group/sub/project.git"
    );
  });
});

describe("provider API normalization", () => {
  it("validates a GitHub token and maps repositories", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        calls.push({ url, headers: new Headers(init?.headers) });
        if (url === "https://api.github.com/user") {
          return Response.json({ id: 7, login: "octo", name: "Octo Cat" });
        }
        return Response.json(
          [
            {
              id: 11,
              full_name: "octo/hello",
              name: "hello",
              default_branch: "trunk",
              private: true,
              html_url: "https://github.com/octo/hello",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
          {
            headers: {
              link: '<https://api.github.com/user/repos?page=2>; rel="next"',
            },
          }
        );
      })
    );

    const identity = await validateProviderToken("github", "token", env);
    expect(identity).toEqual({
      id: "7",
      username: "octo",
      name: "Octo Cat",
    });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");

    const page = await listProviderRepositories("github", "token", env, 1);
    expect(page.hasMore).toBe(true);
    expect(page.repositories[0]).toMatchObject({
      path: "octo/hello",
      defaultBranch: "trunk",
      private: true,
      remoteUrl: "https://github.com/octo/hello.git",
    });
  });

  it("maps GitLab projects, nested paths, and canonical remotes", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        calls.push({ url, headers: new Headers(init?.headers) });
        if (url.endsWith("/projects/demo%2Fplatform%2Fapi")) {
          return Response.json({
            id: 22,
            path_with_namespace: "demo/platform/api",
            name: "api",
            default_branch: "main",
            visibility: "public",
            web_url: "https://gitlab.example.com/demo/platform/api",
          });
        }
        return Response.json(
          [
            {
              id: 21,
              path_with_namespace: "demo/private-api",
              name: "private-api",
              default_branch: "main",
              visibility: "private",
              web_url: "https://gitlab.example.com/demo/private-api",
            },
          ],
          { headers: { "x-next-page": "2" } }
        );
      })
    );

    const repository = await getProviderRepository(
      "gitlab",
      "token",
      env,
      "demo/platform/api"
    );
    expect(repository.remoteUrl).toBe(
      "https://gitlab.example.com/demo/platform/api.git"
    );
    expect(calls[0]!.url).toBe(
      "https://gitlab.example.com/api/v4/projects/demo%2Fplatform%2Fapi"
    );
    expect(calls[0]!.headers.get("private-token")).toBe("token");

    const page = await listProviderRepositories("gitlab", "token", env, 1);
    expect(page.hasMore).toBe(true);
    expect(page.repositories[0]).toMatchObject({
      path: "demo/private-api",
      private: true,
      remoteUrl: "https://gitlab.example.com/demo/private-api.git",
    });
  });
});
