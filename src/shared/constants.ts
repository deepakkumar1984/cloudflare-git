export const DEFAULT_APP_NAME = "Cloudflare Git";
export const THEME_STORAGE_KEY = "cloudflare-git-theme";
export const LEGACY_THEME_STORAGE_KEY = "deesha-theme";
export const IMPORT_TOKEN_PREFIX = "cf_git_import_";

export function configuredAppName(value: string | undefined): string {
  const name = value?.trim();
  return name || DEFAULT_APP_NAME;
}

export const ROLES = [
  "guest",
  "reporter",
  "developer",
  "maintainer",
  "owner",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  guest: 10,
  reporter: 20,
  developer: 30,
  maintainer: 40,
  owner: 50,
};

export const ROLE_LABELS: Record<Role, string> = {
  guest: "Guest",
  reporter: "Reporter",
  developer: "Developer",
  maintainer: "Maintainer",
  owner: "Owner",
};

export const VISIBILITIES = ["private", "internal"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const ISSUE_STATES = ["opened", "closed"] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export const MR_STATES = ["opened", "merged", "closed"] as const;
export type MrState = (typeof MR_STATES)[number];

export const MERGE_DETECTIONS = [
  "none",
  "fast_forward",
  "merge_commit",
  "heuristic",
  "manual",
] as const;
export type MergeDetection = (typeof MERGE_DETECTIONS)[number];

export const REVIEW_STATES = [
  "pending",
  "approved",
  "changes_requested",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const MILESTONE_STATES = ["active", "closed"] as const;
export type MilestoneState = (typeof MILESTONE_STATES)[number];

export const PROVISIONING_STATES = ["pending", "ready", "failed"] as const;
export type ProvisioningState = (typeof PROVISIONING_STATES)[number];

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Route words that cannot be used as a group or project path. */
export const RESERVED_SLUGS = new Set([
  "api",
  "assets",
  "auth",
  "dashboard",
  "groups",
  "health",
  "login",
  "new",
  "search",
  "settings",
  "sign-in",
  "sign-up",
  "users",
]);

export const DEFAULT_BRANCH = "main";
export const GIT_TOKEN_TTL_SECONDS = 30 * 60;
export const SYNC_LEASE_SECONDS = 5 * 60;
export const SYNC_MIN_INTERVAL_SECONDS = 30;
export const PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_TITLE_LENGTH = 255;
export const MAX_BODY_LENGTH = 100_000;
export const MAX_INLINE_FILE_BYTES = 1_048_576;
export const MAX_DIFF_FILES = 300;
export const MAX_TREE_ENTRIES = 2_000;
export const MAX_PATH_SEGMENTS = 50;
export const MAX_DIFF_TREE_ENTRIES = 2_000;
export const MAX_DIFF_DEPTH = 50;
export const MAX_DIFF_PATCH_BYTES = 5 * 1_048_576;
export const MAX_LOG_COMMITS = 1_000;

export const BOARD_DEFAULT_LISTS = [
  { name: "To Do", color: "#8b8b8b" },
  { name: "In Progress", color: "#d98e2b" },
  { name: "Done", color: "#2f8f5b" },
] as const;

export const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;

export const GIT_PROVIDERS = ["github", "gitlab"] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];

export const GIT_PROVIDER_LABELS: Record<GitProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

export const IMPORT_PROXY_TTL_SECONDS = 30 * 60;
export const IMPORT_PROXY_MAX_REQUESTS_PER_MINUTE = 600;
export const MAX_IMPORT_DEPTH = 10_000;
export const MAX_PROVIDER_REPO_SEGMENTS = 20;
