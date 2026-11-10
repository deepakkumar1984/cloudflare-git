import { spawn } from "node:child_process";
import { config } from "dotenv";

config({ path: ".dev.vars", quiet: true });

const env = { ...process.env };
const localHyperdrive =
  env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;
if (!localHyperdrive && env.DATABASE_URL) {
  // The Vite plugin requires a local Hyperdrive connection string even when
  // the app reads DATABASE_URL directly in development. Point its local
  // emulation at the same managed database instead of committing credentials.
  env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE =
    env.DATABASE_URL;
}

const args = process.argv.slice(2);
const viteArgs = args[0] === "preview" ? args : ["dev", ...args];

const child = spawn("npx", ["vite", ...viteArgs], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
