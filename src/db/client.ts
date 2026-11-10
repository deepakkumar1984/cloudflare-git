import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export type { Sql };

export interface DatabaseHandle {
  db: Database;
  sql: Sql;
  close(): Promise<void>;
}

/**
 * Workers always go through Hyperdrive. Local development uses Wrangler's
 * Hyperdrive emulation; scripts/dev.ts points it at DATABASE_URL unless an
 * explicit local connection string (for example, an isolated E2E database) is
 * already set. DATABASE_URL remains a direct fallback for non-Worker callers.
 */
export function resolveDatabaseConnectionString(env: {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString?: string };
}): string {
  const hyperdrive = env.HYPERDRIVE?.connectionString;
  if (hyperdrive) return hyperdrive;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  throw new Error("No database connection is configured");
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const sql = postgres(connectionString, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    fetch_types: false,
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
