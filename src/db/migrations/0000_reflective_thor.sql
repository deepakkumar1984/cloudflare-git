CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`project_id` text,
	`group_id` text,
	`action` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`ip_address` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_events_project_created_idx` ON `audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_group_created_idx` ON `audit_events` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `board_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`label_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_lists_board_position_uq` ON `board_lists` (`board_id`,`position`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text DEFAULT 'Board' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boards_project_uq` ON `boards` (`project_id`);--> statement-breakpoint
CREATE TABLE `discussions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`noteable_type` text NOT NULL,
	`noteable_id` text NOT NULL,
	`resolvable` integer DEFAULT false NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`resolved_by_id` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `discussions_noteable_idx` ON `discussions` (`noteable_type`,`noteable_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`group_id` text,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_iid` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedupe_uq` ON `events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `events_project_created_idx` ON `events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_group_created_idx` ON `events` (`group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_actor_created_idx` ON `events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `git_commits` (
	`project_id` text NOT NULL,
	`sha` text NOT NULL,
	`tree_sha` text NOT NULL,
	`message` text NOT NULL,
	`author_name` text NOT NULL,
	`author_email` text NOT NULL,
	`committer_name` text NOT NULL,
	`committer_email` text NOT NULL,
	`authored_at` integer NOT NULL,
	`committed_at` integer NOT NULL,
	`parents` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `sha`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `git_commits_project_committed_idx` ON `git_commits` (`project_id`,`committed_at`);--> statement-breakpoint
CREATE TABLE `git_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`ref_name` text NOT NULL,
	`ref_type` text NOT NULL,
	`sha` text NOT NULL,
	`last_event_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `git_refs_project_ref_uq` ON `git_refs` (`project_id`,`ref_name`);--> statement-breakpoint
CREATE INDEX `git_refs_project_type_idx` ON `git_refs` (`project_id`,`ref_type`);--> statement-breakpoint
CREATE TABLE `git_sync_leases` (
	`project_id` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `git_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`ref_name` text NOT NULL,
	`before_sha` text,
	`after_sha` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error` text,
	`workflow_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `git_sync_runs_project_ref_after_uq` ON `git_sync_runs` (`project_id`,`ref_name`,`after_sha`);--> statement-breakpoint
CREATE INDEX `git_sync_runs_project_created_idx` ON `git_sync_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `git_token_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`artifacts_token_id` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `git_token_grants_artifacts_token_uq` ON `git_token_grants` (`artifacts_token_id`);--> statement-breakpoint
CREATE INDEX `git_token_grants_project_user_idx` ON `git_token_grants` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `git_token_grants_active_idx` ON `git_token_grants` (`project_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_members_group_user_uq` ON `group_members` (`group_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `group_members_user_idx` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`personal` integer DEFAULT false NOT NULL,
	`parent_id` text,
	`created_by` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_slug_uq` ON `groups` (`slug`);--> statement-breakpoint
CREATE INDEX `groups_created_by_idx` ON `groups` (`created_by`);--> statement-breakpoint
CREATE TABLE `import_proxy_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`project_import_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_repo` text NOT NULL,
	`git_base_url` text NOT NULL,
	`encrypted_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_import_id`) REFERENCES `project_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_proxy_sessions_token_uq` ON `import_proxy_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `import_proxy_sessions_expires_idx` ON `import_proxy_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `issue_assignees` (
	`issue_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`issue_id`, `user_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_assignees_user_idx` ON `issue_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`issue_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`issue_id`, `label_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_labels_label_idx` ON `issue_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`iid` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'opened' NOT NULL,
	`author_id` text NOT NULL,
	`milestone_id` text,
	`due_date` text,
	`confidential` integer DEFAULT false NOT NULL,
	`closed_by_id` text,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_project_iid_uq` ON `issues` (`project_id`,`iid`);--> statement-breakpoint
CREATE INDEX `issues_project_state_idx` ON `issues` (`project_id`,`state`);--> statement-breakpoint
CREATE INDEX `issues_project_updated_idx` ON `issues` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`color` text DEFAULT '#8b8b8b' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_project_title_uq` ON `labels` (`project_id`,`title`);--> statement-breakpoint
CREATE TABLE `merge_request_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`merge_request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sha` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`merge_request_id`) REFERENCES `merge_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merge_request_approvals_mr_user_uq` ON `merge_request_approvals` (`merge_request_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `merge_request_approvals_mr_idx` ON `merge_request_approvals` (`merge_request_id`);--> statement-breakpoint
CREATE TABLE `merge_request_assignees` (
	`merge_request_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`merge_request_id`, `user_id`),
	FOREIGN KEY (`merge_request_id`) REFERENCES `merge_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `merge_request_reviewers` (
	`merge_request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`requested_by_id` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	PRIMARY KEY(`merge_request_id`, `user_id`),
	FOREIGN KEY (`merge_request_id`) REFERENCES `merge_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `merge_request_reviewers_user_idx` ON `merge_request_reviewers` (`user_id`);--> statement-breakpoint
CREATE TABLE `merge_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`iid` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'opened' NOT NULL,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`base_sha` text,
	`head_sha` text,
	`target_sha` text,
	`merge_commit_sha` text,
	`merge_detection` text DEFAULT 'none' NOT NULL,
	`draft` integer DEFAULT false NOT NULL,
	`author_id` text NOT NULL,
	`milestone_id` text,
	`merged_by_id` text,
	`merged_at` integer,
	`closed_by_id` text,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`merged_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merge_requests_project_iid_uq` ON `merge_requests` (`project_id`,`iid`);--> statement-breakpoint
CREATE INDEX `merge_requests_project_state_idx` ON `merge_requests` (`project_id`,`state`);--> statement-breakpoint
CREATE INDEX `merge_requests_source_idx` ON `merge_requests` (`project_id`,`source_branch`);--> statement-breakpoint
CREATE INDEX `merge_requests_target_idx` ON `merge_requests` (`project_id`,`target_branch`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_date` text,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_project_title_uq` ON `milestones` (`project_id`,`title`);--> statement-breakpoint
CREATE INDEX `milestones_project_state_idx` ON `milestones` (`project_id`,`state`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`discussion_id` text,
	`noteable_type` text NOT NULL,
	`noteable_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notes_noteable_idx` ON `notes` (`noteable_type`,`noteable_id`);--> statement-breakpoint
CREATE INDEX `notes_discussion_idx` ON `notes` (`discussion_id`);--> statement-breakpoint
CREATE TABLE `project_counters` (
	`project_id` text PRIMARY KEY NOT NULL,
	`next_iid` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_repo` text NOT NULL,
	`external_repo_id` text,
	`remote_url` text NOT NULL,
	`repository_private` integer DEFAULT false NOT NULL,
	`branch` text,
	`depth` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`artifacts_repo_name` text NOT NULL,
	`previous_repo_name` text,
	`error` text,
	`requested_by` text,
	`last_checked_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_imports_project_created_idx` ON `project_imports` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_imports_active_uq` ON `project_imports` (`project_id`) WHERE "project_imports"."status" in ('pending', 'importing');--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_user_uq` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`artifacts_namespace` text NOT NULL,
	`artifacts_repo_name` text NOT NULL,
	`artifacts_remote` text,
	`provisioning_state` text DEFAULT 'pending' NOT NULL,
	`provisioning_error` text,
	`last_synced_at` integer,
	`created_by` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_group_slug_uq` ON `projects` (`group_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_artifacts_repo_uq` ON `projects` (`artifacts_repo_name`);--> statement-breakpoint
CREATE INDEX `projects_group_idx` ON `projects` (`group_id`);--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_token` text NOT NULL,
	`external_user_id` text NOT NULL,
	`external_username` text NOT NULL,
	`external_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_user_provider_uq` ON `provider_connections` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_connections_user_idx` ON `provider_connections` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_uq` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`username` text,
	`display_username` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_uq` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_uq` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);