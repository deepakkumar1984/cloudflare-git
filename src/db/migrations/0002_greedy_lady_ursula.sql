CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`tag_name` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`author_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_project_tag_uq` ON `releases` (`project_id`,`tag_name`);--> statement-breakpoint
CREATE INDEX `releases_project_created_idx` ON `releases` (`project_id`,`created_at`);