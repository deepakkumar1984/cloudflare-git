import type { Database } from "@db/client";
import type { Group, Project } from "@db/schema";
import type { Role } from "@shared/constants";
import type { Auth, AuthSession } from "./auth";

// Secrets and local-only flags live in `.dev.vars` or `wrangler secret put`.
// They are not in wrangler.jsonc, so generated types do not include them.
declare global {
  interface Env {
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    PROVIDER_TOKEN_KEY?: string;
    ADMIN_EMAILS?: string;
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
