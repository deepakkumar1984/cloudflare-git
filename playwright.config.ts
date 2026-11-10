import { defineConfig, devices } from "@playwright/test";

const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:55433/deesha_git_test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    // Always use a dedicated E2E server so tests never write to the managed
    // development/production database.
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    ...(process.env.PLAYWRIGHT_CHROME_PATH
      ? {
          launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH },
        }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run db:migrate && npm run dev:e2e -- --port 5174",
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: e2eDatabaseUrl,
      BETTER_AUTH_URL: "http://localhost:5174",
    },
    url: "http://localhost:5174/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    // Let the E2E wrapper remove its generated `.dev.vars.e2e` file instead
    // of being killed outright.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
