import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";

if (!existsSync("wrangler.jsonc")) {
  console.error("Missing wrangler.jsonc. Run npm run setup.");
  process.exit(1);
}

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
