import type { Database } from "@db/client";
import type { Group, Project } from "@db/schema";
import type { Role } from "@shared/constants";
import type { Auth, AuthSession } from "./auth";

// Secrets and local-only flags live in `.dev.vars` or `wrangler secret put`.
// ENVIRONMENT, BETTER_AUTH_URL, and ADMIN_EMAILS are plain text vars in
// wrangler.jsonc.
declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    PROVIDER_TOKEN_KEY?: string;
    ARTIFACTS_FAKE?: string;
    GITLAB_BASE_URL?: string;
    GIT_PROVIDERS_FAKE?: string;
  }
}

export type Bindings = Env;

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    db: Database;
    auth: Auth;
    session: AuthSession | null;
    group: Group;
    groupRole: Role | null;
    project: Project;
    role: Role | null;
  };
};
