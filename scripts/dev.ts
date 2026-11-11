import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

if (!existsSync("wrangler.jsonc")) {
  console.error("Missing wrangler.jsonc. Run npm run setup.");
  process.exit(1);
}

// A Worker reload can request an optimized chunk after Vite has replaced the
// cache. The Cloudflare plugin treats that miss as fatal, so drop the broken
// directory before start instead of crashing in the runner.
function purgeBrokenViteDepCaches(): void {
  const root = "node_modules/.vite";
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (!name.startsWith("deps")) continue;
    const dir = join(root, name);
    if (depCacheIsBroken(dir)) {
      console.warn(`Removing broken Vite dependency cache ${dir}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function depCacheIsBroken(dir: string): boolean {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return false;
  }
  const metadataPath = join(dir, "_metadata.json");
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
      optimized?: Record<string, { file?: string }>;
      chunks?: Record<string, { file?: string }>;
    };
    for (const entry of [
      ...Object.values(metadata.optimized ?? {}),
      ...Object.values(metadata.chunks ?? {}),
    ]) {
      if (entry.file && !existsSync(join(dir, entry.file))) return true;
    }
  }
  for (const name of names) {
    if (!name.endsWith(".js")) continue;
    const head = readFileSync(join(dir, name), "utf8").slice(0, 20_000);
    for (const line of head.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
      const match = trimmed.match(/from ["']\.\/([^"']+)["']/);
      if (!match) continue;
      const target = match[1]!.split("?")[0]!;
      if (!existsSync(join(dir, target))) return true;
    }
  }
  return false;
}

purgeBrokenViteDepCaches();

config({ path: ".dev.vars", quiet: true });

const migrated = spawnSync(
  "npx",
  ["wrangler", "d1", "migrations", "apply", "DB", "--remote"],
  { stdio: "inherit" }
);
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

const args = process.argv.slice(2);
const viteArgs = args[0] === "preview" ? args : ["dev", ...args];

const child = spawn("npx", ["vite", ...viteArgs], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
