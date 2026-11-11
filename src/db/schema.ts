import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });

const now = () =>
  timestampMs("created_at")
    .notNull()
    .$defaultFn(() => new Date());

const updated = () =>
  timestampMs("updated_at")
    .notNull()
    .$defaultFn(() => new Date());

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const bool = (name: string) => integer(name, { mode: "boolean" });

/* -------------------------------------------------------------------------- */
/* Better Auth tables                                                         */
/* -------------------------------------------------------------------------- */

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: bool("email_verified").notNull().default(false),
    image: text("image"),
    username: text("username"),
    displayUsername: text("display_username"),
    isAdmin: bool("is_admin").notNull().default(false),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("user_email_uq").on(table.email),
    uniqueIndex("user_username_uq").on(table.username),
  ]
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestampMs("expires_at").notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("session_token_uq").on(table.token),
    index("session_user_idx").on(table.userId),
  ]
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestampMs("access_token_expires_at"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [index("account_user_idx").on(table.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

/** Shared by Better Auth's database limiter and the app's own quotas. */
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

/* -------------------------------------------------------------------------- */
/* Enum values (stored as text; SQLite has no native enums)                  */
/* -------------------------------------------------------------------------- */

export const memberRoleValues = [
  "guest",
  "reporter",
  "developer",
  "maintainer",
  "owner",
] as const;
export type MemberRole = (typeof memberRoleValues)[number];

export const visibilityValues = ["private", "internal"] as const;
export type Visibility = (typeof visibilityValues)[number];

export const issueStateValues = ["opened", "closed"] as const;
export type IssueState = (typeof issueStateValues)[number];

export const mergeRequestStateValues = ["opened", "merged", "closed"] as const;
export type MergeRequestState = (typeof mergeRequestStateValues)[number];

export const mergeDetectionValues = [
  "none",
  "fast_forward",
  "merge_commit",
  "heuristic",
  "manual",
] as const;
export type MergeDetection = (typeof mergeDetectionValues)[number];

export const reviewerStateValues = [
  "pending",
  "approved",
  "changes_requested",
] as const;
export type ReviewerState = (typeof reviewerStateValues)[number];

export const milestoneStateValues = ["active", "closed"] as const;
export type MilestoneState = (typeof milestoneStateValues)[number];

export const provisioningStateValues = ["pending", "ready", "failed"] as const;
export type ProvisioningState = (typeof provisioningStateValues)[number];

export const noteableTypeValues = ["issue", "merge_request"] as const;
export type NoteableType = (typeof noteableTypeValues)[number];

export const gitRefTypeValues = ["branch", "tag"] as const;
export type GitRefType = (typeof gitRefTypeValues)[number];

export const syncStatusValues = [
  "running",
  "completed",
  "failed",
  "skipped",
] as const;
export type SyncStatus = (typeof syncStatusValues)[number];

export const gitProviderValues = ["github", "gitlab"] as const;
export type GitProvider = (typeof gitProviderValues)[number];

export const projectImportStatusValues = [
  "pending",
  "importing",
  "ready",
  "failed",
] as const;
export type ProjectImportStatus = (typeof projectImportStatusValues)[number];

/* -------------------------------------------------------------------------- */
/* Groups and projects                                                        */
/* -------------------------------------------------------------------------- */

export const groups = sqliteTable(
  "groups",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility", { enum: visibilityValues })
      .notNull()
      .default("private"),
    personal: bool("personal").notNull().default(false),
    parentId: text("parent_id").references((): AnySQLiteColumn => groups.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    archivedAt: timestampMs("archived_at"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("groups_slug_uq").on(table.slug),
    index("groups_created_by_idx").on(table.createdBy),
  ]
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: memberRoleValues }).notNull(),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("group_members_group_user_uq").on(table.groupId, table.userId),
    index("group_members_user_idx").on(table.userId),
  ]
);

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility", { enum: visibilityValues })
      .notNull()
      .default("private"),
    defaultBranch: text("default_branch").notNull().default("main"),
    artifactsNamespace: text("artifacts_namespace").notNull(),
    artifactsRepoName: text("artifacts_repo_name").notNull(),
    artifactsRemote: text("artifacts_remote"),
    provisioningState: text("provisioning_state", {
      enum: provisioningStateValues,
    })
      .notNull()
      .default("pending"),
    provisioningError: text("provisioning_error"),
    lastSyncedAt: timestampMs("last_synced_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    archivedAt: timestampMs("archived_at"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("projects_group_slug_uq").on(table.groupId, table.slug),
    uniqueIndex("projects_artifacts_repo_uq").on(table.artifactsRepoName),
    index("projects_group_idx").on(table.groupId),
  ]
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: memberRoleValues }).notNull(),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("project_members_project_user_uq").on(
      table.projectId,
      table.userId
    ),
    index("project_members_user_idx").on(table.userId),
  ]
);

export const projectCounters = sqliteTable("project_counters", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  nextIid: integer("next_iid").notNull().default(1),
});

/* -------------------------------------------------------------------------- */
/* Provider connections and repository imports                                */
/* -------------------------------------------------------------------------- */

export const providerConnections = sqliteTable(
  "provider_connections",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: gitProviderValues }).notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    externalUserId: text("external_user_id").notNull(),
    externalUsername: text("external_username").notNull(),
    externalName: text("external_name"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("provider_connections_user_provider_uq").on(
      table.userId,
      table.provider
    ),
    index("provider_connections_user_idx").on(table.userId),
  ]
);

export const projectImports = sqliteTable(
  "project_imports",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: gitProviderValues }).notNull(),
    externalRepo: text("external_repo").notNull(),
    externalRepoId: text("external_repo_id"),
    remoteUrl: text("remote_url").notNull(),
    repositoryPrivate: bool("repository_private").notNull().default(false),
    branch: text("branch"),
    depth: integer("depth"),
    status: text("status", { enum: projectImportStatusValues })
      .notNull()
      .default("pending"),
    artifactsRepoName: text("artifacts_repo_name").notNull(),
    previousRepoName: text("previous_repo_name"),
    error: text("error"),
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    lastCheckedAt: timestampMs("last_checked_at"),
    completedAt: timestampMs("completed_at"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    index("project_imports_project_created_idx").on(
      table.projectId,
      table.createdAt
    ),
    uniqueIndex("project_imports_active_uq")
      .on(table.projectId)
      .where(sql`${table.status} in ('pending', 'importing')`),
  ]
);

export const importProxySessions = sqliteTable(
  "import_proxy_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    projectImportId: text("project_import_id")
      .notNull()
      .references(() => projectImports.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: gitProviderValues }).notNull(),
    externalRepo: text("external_repo").notNull(),
    gitBaseUrl: text("git_base_url").notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    revokedAt: timestampMs("revoked_at"),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("import_proxy_sessions_token_uq").on(table.tokenHash),
    index("import_proxy_sessions_expires_idx").on(table.expiresAt),
  ]
);

/* -------------------------------------------------------------------------- */
/* Work items                                                                 */
/* -------------------------------------------------------------------------- */

export const labels = sqliteTable(
  "labels",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    color: text("color").notNull().default("#8b8b8b"),
    description: text("description").notNull().default(""),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("labels_project_title_uq").on(table.projectId, table.title),
  ]
);

export const milestones = sqliteTable(
  "milestones",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    dueDate: text("due_date"),
    state: text("state", { enum: milestoneStateValues })
      .notNull()
      .default("active"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("milestones_project_title_uq").on(table.projectId, table.title),
    index("milestones_project_state_idx").on(table.projectId, table.state),
  ]
);

export const releases = sqliteTable(
  "releases",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagName: text("tag_name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    authorId: text("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("releases_project_tag_uq").on(table.projectId, table.tagName),
    index("releases_project_created_idx").on(table.projectId, table.createdAt),
  ]
);

export const todoActionValues = [
  "assigned",
  "review_requested",
  "mentioned",
] as const;
export const todoStateValues = ["pending", "done"] as const;
export const todoTargetValues = ["issue", "merge_request"] as const;

export const todos = sqliteTable(
  "todos",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action", { enum: todoActionValues }).notNull(),
    targetType: text("target_type", { enum: todoTargetValues }).notNull(),
    targetId: text("target_id").notNull(),
    targetIid: integer("target_iid").notNull(),
    noteId: text("note_id"),
    state: text("state", { enum: todoStateValues })
      .notNull()
      .default("pending"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    index("todos_user_state_idx").on(table.userId, table.state),
    index("todos_user_target_idx").on(
      table.userId,
      table.targetType,
      table.targetId,
      table.action
    ),
  ]
);

export const issues = sqliteTable(
  "issues",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    iid: integer("iid").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    state: text("state", { enum: issueStateValues })
      .notNull()
      .default("opened"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    milestoneId: text("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    dueDate: text("due_date"),
    confidential: bool("confidential").notNull().default(false),
    closedById: text("closed_by_id").references(() => user.id),
    closedAt: timestampMs("closed_at"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("issues_project_iid_uq").on(table.projectId, table.iid),
    index("issues_project_state_idx").on(table.projectId, table.state),
    index("issues_project_updated_idx").on(table.projectId, table.updatedAt),
  ]
);

export const issueAssignees = sqliteTable(
  "issue_assignees",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.userId] }),
    index("issue_assignees_user_idx").on(table.userId),
  ]
);

export const issueLabels = sqliteTable(
  "issue_labels",
  {
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.labelId] }),
    index("issue_labels_label_idx").on(table.labelId),
  ]
);

export const discussions = sqliteTable(
  "discussions",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    noteableType: text("noteable_type", { enum: noteableTypeValues }).notNull(),
    noteableId: text("noteable_id").notNull(),
    resolvable: bool("resolvable").notNull().default(false),
    resolved: bool("resolved").notNull().default(false),
    resolvedById: text("resolved_by_id").references(() => user.id),
    resolvedAt: timestampMs("resolved_at"),
    createdAt: now(),
  },
  (table) => [
    index("discussions_noteable_idx").on(table.noteableType, table.noteableId),
  ]
);

export const notes = sqliteTable(
  "notes",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    discussionId: text("discussion_id").references(() => discussions.id, {
      onDelete: "cascade",
    }),
    noteableType: text("noteable_type", { enum: noteableTypeValues }).notNull(),
    noteableId: text("noteable_id").notNull(),
    authorId: text("author_id").references(() => user.id),
    body: text("body").notNull(),
    system: bool("system").notNull().default(false),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    index("notes_noteable_idx").on(table.noteableType, table.noteableId),
    index("notes_discussion_idx").on(table.discussionId),
  ]
);

export const mergeRequests = sqliteTable(
  "merge_requests",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    iid: integer("iid").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    state: text("state", { enum: mergeRequestStateValues })
      .notNull()
      .default("opened"),
    sourceBranch: text("source_branch").notNull(),
    targetBranch: text("target_branch").notNull(),
    baseSha: text("base_sha"),
    headSha: text("head_sha"),
    targetSha: text("target_sha"),
    mergeCommitSha: text("merge_commit_sha"),
    mergeDetection: text("merge_detection", { enum: mergeDetectionValues })
      .notNull()
      .default("none"),
    draft: bool("draft").notNull().default(false),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    milestoneId: text("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    mergedById: text("merged_by_id").references(() => user.id),
    mergedAt: timestampMs("merged_at"),
    closedById: text("closed_by_id").references(() => user.id),
    closedAt: timestampMs("closed_at"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("merge_requests_project_iid_uq").on(table.projectId, table.iid),
    index("merge_requests_project_state_idx").on(table.projectId, table.state),
    index("merge_requests_source_idx").on(table.projectId, table.sourceBranch),
    index("merge_requests_target_idx").on(table.projectId, table.targetBranch),
  ]
);

export const mergeRequestAssignees = sqliteTable(
  "merge_request_assignees",
  {
    mergeRequestId: text("merge_request_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.mergeRequestId, table.userId] })]
);

export const mergeRequestReviewers = sqliteTable(
  "merge_request_reviewers",
  {
    mergeRequestId: text("merge_request_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    state: text("state", { enum: reviewerStateValues })
      .notNull()
      .default("pending"),
    requestedById: text("requested_by_id").references(() => user.id),
    requestedAt: now(),
    reviewedAt: timestampMs("reviewed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.mergeRequestId, table.userId] }),
    index("merge_request_reviewers_user_idx").on(table.userId),
  ]
);

export const mergeRequestApprovals = sqliteTable(
  "merge_request_approvals",
  {
    id: id(),
    mergeRequestId: text("merge_request_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("merge_request_approvals_mr_user_uq").on(
      table.mergeRequestId,
      table.userId
    ),
    index("merge_request_approvals_mr_idx").on(table.mergeRequestId),
  ]
);

export const boards = sqliteTable(
  "boards",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Board"),
    createdAt: now(),
  },
  (table) => [uniqueIndex("boards_project_uq").on(table.projectId)]
);

export const boardLists = sqliteTable(
  "board_lists",
  {
    id: id(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("board_lists_board_position_uq").on(
      table.boardId,
      table.position
    ),
  ]
);

/* -------------------------------------------------------------------------- */
/* Activity and audit                                                         */
/* -------------------------------------------------------------------------- */

export const events = sqliteTable(
  "events",
  {
    id: id(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    groupId: text("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id").references(() => user.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetIid: integer("target_iid"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    dedupeKey: text("dedupe_key"),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("events_dedupe_uq").on(table.dedupeKey),
    index("events_project_created_idx").on(table.projectId, table.createdAt),
    index("events_group_created_idx").on(table.groupId, table.createdAt),
    index("events_actor_created_idx").on(table.actorId, table.createdAt),
  ]
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: id(),
    actorId: text("actor_id").references(() => user.id),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    groupId: text("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    action: text("action").notNull(),
    detail: text("detail", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ipAddress: text("ip_address"),
    createdAt: now(),
  },
  (table) => [
    index("audit_events_project_created_idx").on(
      table.projectId,
      table.createdAt
    ),
    index("audit_events_group_created_idx").on(table.groupId, table.createdAt),
  ]
);

/* -------------------------------------------------------------------------- */
/* Git projection                                                             */
/* -------------------------------------------------------------------------- */

export const gitRefs = sqliteTable(
  "git_refs",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    refName: text("ref_name").notNull(),
    refType: text("ref_type", { enum: gitRefTypeValues }).notNull(),
    sha: text("sha").notNull(),
    lastEventAt: timestampMs("last_event_at"),
    deletedAt: timestampMs("deleted_at"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("git_refs_project_ref_uq").on(table.projectId, table.refName),
    index("git_refs_project_type_idx").on(table.projectId, table.refType),
  ]
);

export const gitCommits = sqliteTable(
  "git_commits",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    treeSha: text("tree_sha").notNull(),
    message: text("message").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    committerName: text("committer_name").notNull(),
    committerEmail: text("committer_email").notNull(),
    authoredAt: timestampMs("authored_at").notNull(),
    committedAt: timestampMs("committed_at").notNull(),
    parents: text("parents", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.sha] }),
    index("git_commits_project_committed_idx").on(
      table.projectId,
      table.committedAt
    ),
  ]
);

export const gitSyncRuns = sqliteTable(
  "git_sync_runs",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    refName: text("ref_name").notNull(),
    beforeSha: text("before_sha"),
    afterSha: text("after_sha").notNull(),
    status: text("status", { enum: syncStatusValues })
      .notNull()
      .default("running"),
    error: text("error"),
    workflowId: text("workflow_id"),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("git_sync_runs_project_ref_after_uq").on(
      table.projectId,
      table.refName,
      table.afterSha
    ),
    index("git_sync_runs_project_created_idx").on(
      table.projectId,
      table.createdAt
    ),
  ]
);

export const gitSyncLeases = sqliteTable("git_sync_leases", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  holder: text("holder").notNull(),
  expiresAt: timestampMs("expires_at").notNull(),
});

export const gitTokenGrants = sqliteTable(
  "git_token_grants",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    artifactsTokenId: text("artifacts_token_id").notNull(),
    scope: text("scope").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    revokedAt: timestampMs("revoked_at"),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("git_token_grants_artifacts_token_uq").on(
      table.artifactsTokenId
    ),
    index("git_token_grants_project_user_idx").on(
      table.projectId,
      table.userId
    ),
    index("git_token_grants_active_idx").on(table.projectId, table.revokedAt),
  ]
);

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type User = typeof user.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type MergeRequest = typeof mergeRequests.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Release = typeof releases.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type GitRef = typeof gitRefs.$inferSelect;
export type GitCommit = typeof gitCommits.$inferSelect;
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type ProjectImport = typeof projectImports.$inferSelect;
export type ImportProxySession = typeof importProxySessions.$inferSelect;
