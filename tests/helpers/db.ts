import { readdirSync, readFileSync } from "node:fs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createDatabase, type Database } from "@db/client";

/**
 * Integration tests use an in-memory Miniflare D1 database. They must never
 * open the production D1 database or the managed Postgres database.
 */
const DELETE_ORDER = [
  "git_token_grants",
  "git_sync_leases",
  "git_sync_runs",
  "git_commits",
  "git_refs",
  "audit_events",
  "events",
  "board_lists",
  "boards",
  "merge_request_approvals",
  "merge_request_reviewers",
  "merge_request_assignees",
  "merge_requests",
  "notes",
  "discussions",
  "issue_labels",
  "issue_assignees",
  "issues",
  "milestones",
  "labels",
  "import_proxy_sessions",
  "project_imports",
  "provider_connections",
  "project_counters",
  "project_members",
  "projects",
  "group_members",
  "groups",
  "verification",
  "rate_limit",
  "account",
  "session",
  "user",
] as const;

let miniflare: Miniflare | null = null;
let cached: { db: Database; d1: D1Database } | null = null;

async function applyMigrations(d1: D1Database): Promise<void> {
  await d1
    .prepare(
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    .run();
  const applied = await d1.prepare("SELECT name FROM d1_migrations").all<{
    name: string;
  }>();
  const have = new Set((applied.results ?? []).map((row) => row.name));
  const files = readdirSync("./src/db/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    if (have.has(name)) continue;
    const sqlText = readFileSync(`./src/db/migrations/${name}`, "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    if (statements.length === 0) continue;
    await d1.batch(statements.map((statement) => d1.prepare(statement)));
    await d1
      .prepare("INSERT INTO d1_migrations (name) VALUES (?)")
      .bind(name)
      .run();
  }
}

export async function getTestDatabase(): Promise<{
  db: Database;
  d1: D1Database;
}> {
  if (cached) return cached;
  miniflare = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script:
        "export default { async fetch() { return new Response(null, { status: 404 }); } };",
      d1Databases: { DB: "cloudflare-git-test" },
      compatibilityDate: "2026-11-10",
      compatibilityFlags: ["nodejs_compat"],
    })
  );
  const d1 = await miniflare.getD1Database("DB");
  await applyMigrations(d1);
  cached = { db: createDatabase(d1), d1 };
  return cached;
}

export async function resetDatabase(): Promise<void> {
  const { d1 } = await getTestDatabase();
  await d1.exec("PRAGMA foreign_keys = OFF");
  await d1.batch(
    DELETE_ORDER.map((table) => d1.prepare(`DELETE FROM ${table}`))
  );
  await d1.exec("PRAGMA foreign_keys = ON");
}

export async function closeTestDatabase(): Promise<void> {
  cached = null;
  const current = miniflare;
  miniflare = null;
  await current?.dispose();
}
