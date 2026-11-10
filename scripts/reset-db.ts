import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

config({ path: ".dev.vars" });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required in .dev.vars");
}

const parsed = new URL(url);
const local =
  (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
  parsed.port === "55432";
if (!local) {
  throw new Error(
    "Refusing to reset a database that is not the local Docker database on port 55432"
  );
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  console.warn(
    `Resetting ${parsed.pathname.replace(/^\//, "")} at ${parsed.host}`
  );
  await sql.unsafe('DROP SCHEMA IF EXISTS "drizzle" CASCADE');
  await sql.unsafe('DROP SCHEMA IF EXISTS "public" CASCADE');
  await sql.unsafe('CREATE SCHEMA "public"');
  await migrate(drizzle(sql), { migrationsFolder: "./src/db/migrations" });
  console.log("Local database reset and migrations applied.");
} finally {
  await sql.end({ timeout: 5 });
}
