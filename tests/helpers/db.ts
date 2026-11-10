import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, type DatabaseHandle } from "@db/client";

config({ path: ".dev.vars" });

/**
 * The application uses the managed database for local development and
 * production. Tests must never truncate that database, so they always run
 * against the isolated Docker Postgres on port 55433.
 */
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:55433/deesha_git_test";

function assertSafeTestUrl(value: string): void {
  const parsed = new URL(value);
  const localHost =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  const testPort = parsed.port === "55433";
  const testName = parsed.pathname.replace(/^\//, "").endsWith("_test");
  if (!localHost || !testPort || !testName) {
    throw new Error(
      "Refusing to use TEST_DATABASE_URL: expected a localhost:55433 database whose name ends with _test"
    );
  }
}

export const testDbAvailable = true;

let handle: DatabaseHandle | null = null;

export async function getTestDatabase(): Promise<DatabaseHandle> {
  if (handle) return handle;
  assertSafeTestUrl(testDatabaseUrl);
  const created = createDatabase(testDatabaseUrl);
  await migrate(created.db, { migrationsFolder: "./src/db/migrations" });
  handle = created;
  return created;
}

export async function resetDatabase(): Promise<void> {
  const { sql } = await getTestDatabase();
  const tables = await sql<{ tablename: string }[]>`
    select tablename
    from pg_tables
    where schemaname = 'public' and tablename <> '__drizzle_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables
    .map((row) => `"${row.tablename.replaceAll('"', '""')}"`)
    .join(", ");
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function closeTestDatabase(): Promise<void> {
  if (!handle) return;
  const current = handle;
  handle = null;
  await current.close();
}
