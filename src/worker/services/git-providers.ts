import {
  MAX_PROVIDER_REPO_SEGMENTS,
  type GitProvider,
} from "@shared/constants";
import { badRequest, conflict, notFound } from "@worker/lib/errors";

export type ProviderEnv = Env & {
  GITLAB_BASE_URL?: string;
  GIT_PROVIDERS_FAKE?: string;
};

export interface ProviderIdentity {
  id: string;
  username: string;
  name: string | null;
}

export interface ProviderRepository {
  id: string;
  path: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  remoteUrl: string;
  webUrl: string;
  updatedAt: string | null;
}

export interface ProviderRepositoryPage {
  repositories: ProviderRepository[];
  hasMore: boolean;
}

export interface ParsedProviderRepositoryUrl {
  provider: GitProvider;
  externalRepo: string;
  remoteUrl: string;
}

interface ProviderEndpoints {
  apiBaseUrl: string;
  gitBaseUrl: string;
}

const FAKE_GITHUB_REPOSITORIES: ProviderRepository[] = [
  {
    id: "fake-1",
    path: "demo/hello-world",
    name: "hello-world",
    defaultBranch: "main",
    private: false,
    remoteUrl: "https://github.com/demo/hello-world.git",
    webUrl: "https://github.com/demo/hello-world",
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "fake-2",
    path: "demo/private-service",
    name: "private-service",
    defaultBranch: "main",
    private: true,
    remoteUrl: "https://github.com/demo/private-service.git",
    webUrl: "https://github.com/demo/private-service",
    updatedAt: new Date(0).toISOString(),
  },
];

const FAKE_GITLAB_REPOSITORIES: ProviderRepository[] = [
  {
    id: "fake-10",
    path: "demo/platform/api",
    name: "api",
    defaultBranch: "main",
    private: false,
    remoteUrl: "https://gitlab.com/demo/platform/api.git",
    webUrl: "https://gitlab.com/demo/platform/api",
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "fake-11",
    path: "demo/private-api",
    name: "private-api",
    defaultBranch: "main",
    private: true,
    remoteUrl: "https://gitlab.com/demo/private-api.git",
    webUrl: "https://gitlab.com/demo/private-api",
    updatedAt: new Date(0).toISOString(),
  },
];

function useFakeProviders(env: ProviderEnv): boolean {
  return (
    env.GIT_PROVIDERS_FAKE === "true" &&
    (env.ENVIRONMENT as string) !== "production"
  );
}

function providerEndpoints(
  provider: GitProvider,
  env: ProviderEnv
): ProviderEndpoints {
  if (provider === "github") {
    return {
      apiBaseUrl: "https://api.github.com",
      gitBaseUrl: "https://github.com",
    };
  }

  const configured = env.GITLAB_BASE_URL || "https://gitlab.com";
  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    throw new Error("GITLAB_BASE_URL is invalid");
  }
  if (base.protocol !== "https:") {
    throw new Error("GITLAB_BASE_URL must use HTTPS");
  }
  return {
    apiBaseUrl: `${base.origin}/api/v4`,
    gitBaseUrl: base.origin,
  };
}

export function providerLabel(provider: GitProvider): string {
  return provider === "github" ? "GitHub" : "GitLab";
}

export function validateExternalRepo(
  provider: GitProvider,
  externalRepo: string
): string {
  const value = externalRepo.trim();
  const segments = value.split("/");
  if (
    segments.length < 2 ||
    segments.length > MAX_PROVIDER_REPO_SEGMENTS ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9_.-]+$/.test(segment)
    )
  ) {
    throw badRequest("Invalid provider repository path");
  }
  if (provider === "github" && segments.length !== 2) {
    throw badRequest("GitHub repositories use the owner/repository format");
  }
  return value;
}

export function providerRemoteUrl(
  provider: GitProvider,
  externalRepo: string,
  env: ProviderEnv
): string {
  const path = validateExternalRepo(provider, externalRepo);
  const { gitBaseUrl } = providerEndpoints(provider, env);
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${gitBaseUrl}/${encodedPath}.git`;
}

/**
 * Accepts a browser or clone URL and canonicalizes it. Query strings and
 * fragments are ignored; embedded credentials are rejected.
 */
export function parseProviderRepositoryUrl(
  value: string,
  env: ProviderEnv
): ParsedProviderRepositoryUrl {
  const input = value.trim();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw badRequest("Enter a valid HTTPS repository URL");
  }
  if (url.protocol !== "https:") {
    throw badRequest("Repository URLs must use HTTPS");
  }
  if (url.username || url.password) {
    throw badRequest("Remove credentials from the repository URL");
  }

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw badRequest("Repository URL contains an invalid path");
      }
    });
  if (segments.length < 2 || segments.some((segment) => segment === "-")) {
    throw badRequest("Enter a repository URL, not a file or branch URL");
  }
  const last = segments.at(-1)!;
  segments[segments.length - 1] = last.replace(/\.git$/i, "");
  const externalRepo = segments.join("/");

  const githubBase = new URL(providerEndpoints("github", env).gitBaseUrl)
    .origin;
  const gitlabBase = new URL(providerEndpoints("gitlab", env).gitBaseUrl)
    .origin;
  let provider: GitProvider;
  if (url.origin === githubBase) {
    provider = "github";
  } else if (url.origin === gitlabBase) {
    provider = "gitlab";
  } else {
    throw badRequest(
      "Use a github.com, gitlab.com, or configured GitLab HTTPS URL"
    );
  }

  return {
    provider,
    externalRepo: validateExternalRepo(provider, externalRepo),
    remoteUrl: providerRemoteUrl(provider, externalRepo, env),
  };
}

export function providerGitAuthorization(
  provider: GitProvider,
  token: string
): string {
  const username = provider === "github" ? "x-access-token" : "oauth2";
  return `Basic ${btoa(`${username}:${token}`)}`;
}

function apiHeaders(
  provider: GitProvider,
  token: string | undefined
): HeadersInit {
  if (provider === "github") {
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cloudflare-git",
    };
  }
  return {
    ...(token ? { "PRIVATE-TOKEN": token } : {}),
    Accept: "application/json",
    "User-Agent": "cloudflare-git",
  };
}

function throwProviderError(
  provider: GitProvider,
  status: number,
  operation: "auth" | "list" | "repository"
): never {
  const label = providerLabel(provider);
  if (status === 401 || status === 403) {
    if (operation === "auth") {
      throw badRequest(`${label} rejected this token or it has expired`);
    }
    throw badRequest(`${label} denied access to this repository`);
  }
  if (status === 404) {
    throw notFound(
      `${label} repository not found or not visible to this token`
    );
  }
  if (status === 429) {
    throw conflict(`${label} rate limit reached. Try again shortly.`);
  }
  throw conflict(`${label} request failed (${status})`);
}

async function providerFetch(
  provider: GitProvider,
  token: string | undefined,
  env: ProviderEnv,
  path: string,
  operation: "auth" | "list" | "repository"
): Promise<Response> {
  const { apiBaseUrl } = providerEndpoints(provider, env);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      headers: apiHeaders(provider, token),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw conflict(`Could not reach ${providerLabel(provider)}`);
  }
  if (!response.ok) {
    throwProviderError(provider, response.status, operation);
  }
  return response;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapGithubRepository(
  value: unknown,
  env: ProviderEnv
): ProviderRepository {
  if (!value || typeof value !== "object") {
    throw conflict("GitHub returned an unexpected repository payload");
  }
  const repo = value as Record<string, unknown>;
  const path = readString(repo.full_name);
  const name = readString(repo.name);
  const defaultBranch = readString(repo.default_branch);
  if (!path || !name || !defaultBranch) {
    throw conflict("GitHub returned an incomplete repository payload");
  }
  return {
    id: String(repo.id ?? path),
    path,
    name,
    defaultBranch,
    private: repo.private === true,
    remoteUrl: providerRemoteUrl("github", path, env),
    webUrl: readString(repo.html_url) ?? `https://github.com/${path}`,
    updatedAt: readString(repo.updated_at),
  };
}

function mapGitlabRepository(
  value: unknown,
  env: ProviderEnv
): ProviderRepository {
  if (!value || typeof value !== "object") {
    throw conflict("GitLab returned an unexpected repository payload");
  }
  const repo = value as Record<string, unknown>;
  const path = readString(repo.path_with_namespace);
  const name = readString(repo.name) ?? path?.split("/").at(-1) ?? null;
  const defaultBranch = readString(repo.default_branch) ?? "main";
  if (!path || !name) {
    throw conflict("GitLab returned an incomplete repository payload");
  }
  return {
    id: String(repo.id ?? path),
    path,
    name,
    defaultBranch,
    private: readString(repo.visibility) !== "public",
    remoteUrl: providerRemoteUrl("gitlab", path, env),
    webUrl: readString(repo.web_url) ?? `https://gitlab.com/${path}`,
    updatedAt: readString(repo.last_activity_at),
  };
}

export async function validateProviderToken(
  provider: GitProvider,
  token: string,
  env: ProviderEnv
): Promise<ProviderIdentity> {
  if (useFakeProviders(env)) {
    if (token.length < 8) throw badRequest("Use at least 8 characters");
    return {
      id: `fake-${provider}-user`,
      username: provider === "github" ? "demo-github" : "demo-gitlab",
      name: "Demo Provider",
    };
  }

  const response = await providerFetch(
    provider,
    token,
    env,
    provider === "github" ? "/user" : "/user",
    "auth"
  );
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload) throw conflict("Provider returned an invalid profile");
  const id = payload.id;
  const username =
    provider === "github"
      ? readString(payload.login)
      : readString(payload.username);
  if ((typeof id !== "number" && typeof id !== "string") || !username) {
    throw conflict("Provider returned an incomplete profile");
  }
  return {
    id: String(id),
    username,
    name: readString(payload.name),
  };
}

export async function listProviderRepositories(
  provider: GitProvider,
  token: string,
  env: ProviderEnv,
  page: number
): Promise<ProviderRepositoryPage> {
  if (useFakeProviders(env)) {
    const repositories =
      provider === "github"
        ? FAKE_GITHUB_REPOSITORIES
        : FAKE_GITLAB_REPOSITORIES;
    return { repositories: page === 1 ? repositories : [], hasMore: false };
  }

  const path =
    provider === "github"
      ? `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`
      : `/projects?membership=true&per_page=100&page=${page}&order_by=last_activity_at&sort=desc`;
  const response = await providerFetch(provider, token, env, path, "list");
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) {
    throw conflict("Provider returned an unexpected repository list");
  }
  const repositories = payload.map((item) =>
    provider === "github"
      ? mapGithubRepository(item, env)
      : mapGitlabRepository(item, env)
  );
  const hasMore =
    provider === "github"
      ? /rel="next"/.test(response.headers.get("link") ?? "")
      : Boolean(response.headers.get("x-next-page"));
  return { repositories, hasMore };
}

export async function getProviderRepository(
  provider: GitProvider,
  token: string | undefined,
  env: ProviderEnv,
  externalRepo: string
): Promise<ProviderRepository> {
  const path = validateExternalRepo(provider, externalRepo);
  if (useFakeProviders(env)) {
    const repository = [
      ...FAKE_GITHUB_REPOSITORIES,
      ...FAKE_GITLAB_REPOSITORIES,
    ].find(
      (candidate) =>
        candidate.path === path &&
        (provider === "github"
          ? candidate.remoteUrl.startsWith("https://github.com/")
          : candidate.remoteUrl.startsWith("https://gitlab.com/"))
    );
    if (!repository) throw notFound("Demo repository not found");
    if (!token && repository.private) {
      throw notFound(
        "This demo repository is private. Connect a token to import it."
      );
    }
    return repository;
  }

  const apiPath =
    provider === "github"
      ? `/repos/${path
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/")}`
      : `/projects/${encodeURIComponent(path)}`;
  const response = await providerFetch(
    provider,
    token,
    env,
    apiPath,
    "repository"
  );
  const payload = (await response.json().catch(() => null)) as unknown;
  return provider === "github"
    ? mapGithubRepository(payload, env)
    : mapGitlabRepository(payload, env);
}
