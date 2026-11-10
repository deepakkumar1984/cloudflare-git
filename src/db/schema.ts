import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const now = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updated = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/* -------------------------------------------------------------------------- */
/* Better Auth tables                                                         */
/* -------------------------------------------------------------------------- */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    username: text("username"),
    displayUsername: text("display_username"),
    isAdmin: boolean("is_admin").default(false).notNull(),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("user_email_uq").on(table.email),
    uniqueIndex("user_username_uq").on(table.username),
  ]
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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

export const account = pgTable(
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
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [index("account_user_idx").on(table.userId)]
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const memberRole = pgEnum("member_role", [
  "guest",
  "reporter",
  "developer",
  "maintainer",
  "owner",
]);

export const visibility = pgEnum("visibility", ["private", "internal"]);

export const issueState = pgEnum("issue_state", ["opened", "closed"]);

export const mergeRequestState = pgEnum("merge_request_state", [
  "opened",
  "merged",
  "closed",
]);

export const mergeDetection = pgEnum("merge_detection", [
  "none",
  "fast_forward",
  "merge_commit",
  "heuristic",
  "manual",
]);

export const reviewerState = pgEnum("reviewer_state", [
  "pending",
  "approved",
  "changes_requested",
]);

export const milestoneState = pgEnum("milestone_state", ["active", "closed"]);

export const provisioningState = pgEnum("provisioning_state", [
  "pending",
  "ready",
  "failed",
]);

export const noteableType = pgEnum("noteable_type", ["issue", "merge_request"]);

export const gitRefType = pgEnum("git_ref_type", ["branch", "tag"]);

export const syncStatus = pgEnum("sync_status", [
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const gitProvider = pgEnum("git_provider", ["github", "gitlab"]);

export const projectImportStatus = pgEnum("project_import_status", [
  "pending",
  "importing",
  "ready",
  "failed",
]);

/* -------------------------------------------------------------------------- */
/* Groups and projects                                                        */
/* -------------------------------------------------------------------------- */

export const groups = pgTable(
  "groups",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: visibility("visibility").notNull().default("private"),
    personal: boolean("personal").notNull().default(false),
    parentId: uuid("parent_id").references((): AnyPgColumn => groups.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("groups_slug_uq").on(table.slug),
    index("groups_created_by_idx").on(table.createdBy),
  ]
);

export const groupMembers = pgTable(
  "group_members",
  {
    id: id(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("group_members_group_user_uq").on(table.groupId, table.userId),
    index("group_members_user_idx").on(table.userId),
  ]
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: visibility("visibility").notNull().default("private"),
    defaultBranch: text("default_branch").notNull().default("main"),
    artifactsNamespace: text("artifacts_namespace").notNull(),
    artifactsRepoName: text("artifacts_repo_name").notNull(),
    artifactsRemote: text("artifacts_remote"),
    provisioningState: provisioningState("provisioning_state")
      .notNull()
      .default("pending"),
    provisioningError: text("provisioning_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("projects_group_slug_uq").on(table.groupId, table.slug),
    uniqueIndex("projects_artifacts_repo_uq").on(table.artifactsRepoName),
    index("projects_group_idx").on(table.groupId),
  ]
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
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

export const projectCounters = pgTable("project_counters", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  nextIid: integer("next_iid").notNull().default(1),
});

/* -------------------------------------------------------------------------- */
/* Provider connections and repository imports                                */
/* -------------------------------------------------------------------------- */

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: gitProvider("provider").notNull(),
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

export const projectImports = pgTable(
  "project_imports",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: gitProvider("provider").notNull(),
    externalRepo: text("external_repo").notNull(),
    externalRepoId: text("external_repo_id"),
    remoteUrl: text("remote_url").notNull(),
    repositoryPrivate: boolean("repository_private").notNull().default(false),
    branch: text("branch"),
    depth: integer("depth"),
    status: projectImportStatus("status").notNull().default("pending"),
    artifactsRepoName: text("artifacts_repo_name").notNull(),
    previousRepoName: text("previous_repo_name"),
    error: text("error"),
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
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

export const importProxySessions = pgTable(
  "import_proxy_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    projectImportId: uuid("project_import_id")
      .notNull()
      .references(() => projectImports.id, { onDelete: "cascade" }),
    provider: gitProvider("provider").notNull(),
    externalRepo: text("external_repo").notNull(),
    gitBaseUrl: text("git_base_url").notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    uniqueIndex("import_proxy_sessions_token_uq").on(table.tokenHash),
    index("import_proxy_sessions_expires_idx").on(table.expiresAt),
  ]
);

/* -------------------------------------------------------------------------- */
/* Work items                                                                */
/* -------------------------------------------------------------------------- */

export const labels = pgTable(
  "labels",
  {
    id: id(),
    projectId: uuid("project_id")
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

export const milestones = pgTable(
  "milestones",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    dueDate: date("due_date"),
    state: milestoneState("state").notNull().default("active"),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("milestones_project_title_uq").on(table.projectId, table.title),
    index("milestones_project_state_idx").on(table.projectId, table.state),
  ]
);

export const issues = pgTable(
  "issues",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    iid: integer("iid").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    state: issueState("state").notNull().default("opened"),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date"),
    confidential: boolean("confidential").notNull().default(false),
    closedById: text("closed_by_id").references(() => user.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("issues_project_iid_uq").on(table.projectId, table.iid),
    index("issues_project_state_idx").on(table.projectId, table.state),
    index("issues_project_updated_idx").on(table.projectId, table.updatedAt),
  ]
);

export const issueAssignees = pgTable(
  "issue_assignees",
  {
    issueId: uuid("issue_id")
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

export const issueLabels = pgTable(
  "issue_labels",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.labelId] }),
    index("issue_labels_label_idx").on(table.labelId),
  ]
);

export const discussions = pgTable(
  "discussions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    noteableType: noteableType("noteable_type").notNull(),
    noteableId: uuid("noteable_id").notNull(),
    resolvable: boolean("resolvable").notNull().default(false),
    resolved: boolean("resolved").notNull().default(false),
    resolvedById: text("resolved_by_id").references(() => user.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: now(),
  },
  (table) => [
    index("discussions_noteable_idx").on(table.noteableType, table.noteableId),
  ]
);

export const notes = pgTable(
  "notes",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    discussionId: uuid("discussion_id").references(() => discussions.id, {
      onDelete: "cascade",
    }),
    noteableType: noteableType("noteable_type").notNull(),
    noteableId: uuid("noteable_id").notNull(),
    authorId: text("author_id").references(() => user.id),
    body: text("body").notNull(),
    system: boolean("system").notNull().default(false),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    index("notes_noteable_idx").on(table.noteableType, table.noteableId),
    index("notes_discussion_idx").on(table.discussionId),
  ]
);

export const mergeRequests = pgTable(
  "merge_requests",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    iid: integer("iid").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    state: mergeRequestState("state").notNull().default("opened"),
    sourceBranch: text("source_branch").notNull(),
    targetBranch: text("target_branch").notNull(),
    baseSha: text("base_sha"),
    headSha: text("head_sha"),
    targetSha: text("target_sha"),
    mergeCommitSha: text("merge_commit_sha"),
    mergeDetection: mergeDetection("merge_detection").notNull().default("none"),
    draft: boolean("draft").notNull().default(false),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    mergedById: text("merged_by_id").references(() => user.id),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedById: text("closed_by_id").references(() => user.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
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

export const mergeRequestAssignees = pgTable(
  "merge_request_assignees",
  {
    mergeRequestId: uuid("merge_request_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.mergeRequestId, table.userId] })]
);

export const mergeRequestReviewers = pgTable(
  "merge_request_reviewers",
  {
    mergeRequestId: uuid("merge_request_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    state: reviewerState("state").notNull().default("pending"),
    requestedById: text("requested_by_id").references(() => user.id),
    requestedAt: now(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.mergeRequestId, table.userId] }),
    index("merge_request_reviewers_user_idx").on(table.userId),
  ]
);

export const mergeRequestApprovals = pgTable(
  "merge_request_approvals",
  {
    id: id(),
    mergeRequestId: uuid("merge_request_id")
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

export const boards = pgTable(
  "boards",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Board"),
    createdAt: now(),
  },
  (table) => [uniqueIndex("boards_project_uq").on(table.projectId)]
);

export const boardLists = pgTable(
  "board_lists",
  {
    id: id(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
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

export const events = pgTable(
  "events",
  {
    id: id(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    groupId: uuid("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    actorId: text("actor_id").references(() => user.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetIid: integer("target_iid"),
    metadata: jsonb("metadata")
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

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorId: text("actor_id").references(() => user.id),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    groupId: uuid("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    action: text("action").notNull(),
    detail: jsonb("detail")
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

export const gitRefs = pgTable(
  "git_refs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    refName: text("ref_name").notNull(),
    refType: gitRefType("ref_type").notNull(),
    sha: text("sha").notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: now(),
    updatedAt: updated(),
  },
  (table) => [
    uniqueIndex("git_refs_project_ref_uq").on(table.projectId, table.refName),
    index("git_refs_project_type_idx").on(table.projectId, table.refType),
  ]
);

export const gitCommits = pgTable(
  "git_commits",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    treeSha: text("tree_sha").notNull(),
    message: text("message").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    committerName: text("committer_name").notNull(),
    committerEmail: text("committer_email").notNull(),
    authoredAt: timestamp("authored_at", { withTimezone: true }).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
    parents: text("parents").array().notNull().default([]),
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

export const gitSyncRuns = pgTable(
  "git_sync_runs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    refName: text("ref_name").notNull(),
    beforeSha: text("before_sha"),
    afterSha: text("after_sha").notNull(),
    status: syncStatus("status").notNull().default("running"),
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

export const gitSyncLeases = pgTable("git_sync_leases", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  holder: text("holder").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const gitTokenGrants = pgTable(
  "git_token_grants",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    artifactsTokenId: text("artifacts_token_id").notNull(),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
export type GitRef = typeof gitRefs.$inferSelect;
export type GitCommit = typeof gitCommits.$inferSelect;
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type ProjectImport = typeof projectImports.$inferSelect;
export type ImportProxySession = typeof importProxySessions.$inferSelect;
