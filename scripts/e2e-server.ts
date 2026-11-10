import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { parse } from "dotenv";

// Playwright must never talk to the real Artifacts service or reuse the
// developer's ARTIFACTS_FAKE setting. Wrangler only reads `.dev.vars` for the
// selected environment, so create `.dev.vars.e2e` for this run and select it
// with CLOUDFLARE_ENV. The file is derived from `.dev.vars` and removed when
// the server stops.
if (!existsSync("wrangler.jsonc")) {
  throw new Error("Missing wrangler.jsonc. Run npm run setup.");
}

const devVarsPath = ".dev.vars";
const e2eVarsPath = ".dev.vars.e2e";

let localVars: Record<string, string>;
try {
  localVars = parse(readFileSync(devVarsPath));
} catch {
  throw new Error(
    `Cannot read ${devVarsPath}. Copy .dev.vars.example to .dev.vars before running E2E tests.`
  );
}

const vars: Record<string, string> = {
  ...localVars,
  ARTIFACTS_FAKE: "true",
  ENVIRONMENT: "development",
};
delete vars.DATABASE_URL;
if (process.env.BETTER_AUTH_URL) {
  vars.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;
}

const contents = Object.entries(vars)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  .join("\n");
writeFileSync(e2eVarsPath, `${contents}\n`, { mode: 0o600 });
chmodSync(e2eVarsPath, 0o600);

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  rmSync(e2eVarsPath, { force: true });
}

process.on("exit", cleanup);
for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(exitCode);
  });
}

const child = spawn("npx", ["vite", "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Keep the E2E optimizer cache separate from a running `npm run dev`
    // server so the two processes cannot corrupt each other's cache.
    VITE_E2E: "1",
    CLOUDFLARE_ENV: "e2e",
  },
});

child.on("error", (error) => {
  cleanup();
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 1);
});
