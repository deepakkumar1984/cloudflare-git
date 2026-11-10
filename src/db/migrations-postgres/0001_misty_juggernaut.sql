CREATE TYPE "public"."git_provider" AS ENUM('github', 'gitlab');--> statement-breakpoint
CREATE TYPE "public"."project_import_status" AS ENUM('pending', 'importing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "import_proxy_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"project_import_id" uuid NOT NULL,
	"provider" "git_provider" NOT NULL,
	"external_repo" text NOT NULL,
	"git_base_url" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" "git_provider" NOT NULL,
	"external_repo" text NOT NULL,
	"external_repo_id" text,
	"remote_url" text NOT NULL,
	"branch" text,
	"depth" integer,
	"status" "project_import_status" DEFAULT 'pending' NOT NULL,
	"artifacts_repo_name" text NOT NULL,
	"previous_repo_name" text,
	"error" text,
	"requested_by" text,
	"last_checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "git_provider" NOT NULL,
	"encrypted_token" text NOT NULL,
	"external_user_id" text NOT NULL,
	"external_username" text NOT NULL,
	"external_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_proxy_sessions" ADD CONSTRAINT "import_proxy_sessions_project_import_id_project_imports_id_fk" FOREIGN KEY ("project_import_id") REFERENCES "public"."project_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_imports" ADD CONSTRAINT "project_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_imports" ADD CONSTRAINT "project_imports_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_proxy_sessions_token_uq" ON "import_proxy_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "import_proxy_sessions_expires_idx" ON "import_proxy_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "project_imports_project_created_idx" ON "project_imports" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_imports_active_uq" ON "project_imports" USING btree ("project_id") WHERE "project_imports"."status" in ('pending', 'importing');--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_user_provider_uq" ON "provider_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "provider_connections_user_idx" ON "provider_connections" USING btree ("user_id");