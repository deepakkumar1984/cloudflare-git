import { spawnSync } from "node:child_process";
import { readProjectConfig } from "./project-config";

const config = readProjectConfig();
if (!config?.appUrl) {
  console.error(
    "Missing a public app URL. Run npm run setup and set the URL people will open."
  );
  process.exit(1);
}

const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const deploy = spawnSync(
  "npx",
  [
    "wrangler",
    "deploy",
    "--var",
    `APP_URL:${config.appUrl}`,
    "--var",
    `BETTER_AUTH_URL:${config.appUrl}`,
    "--var",
    "ENVIRONMENT:production",
    "--var",
    `APP_NAME:${config.appName}`,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(config.accountId ? { CLOUDFLARE_ACCOUNT_ID: config.accountId } : {}),
    },
  }
);
process.exit(deploy.status ?? 1);
