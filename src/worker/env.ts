import type { Database, Sql } from "@db/client";
import type { Group, Project } from "@db/schema";
import type { Role } from "@shared/constants";
import type { Auth, AuthSession } from "./auth";

export type Bindings = Env;

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    db: Database;
    sql: Sql;
    auth: Auth;
    session: AuthSession | null;
    group: Group;
    groupRole: Role | null;
    project: Project;
    role: Role | null;
  };
};
