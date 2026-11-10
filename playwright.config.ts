import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    // Dedicated server on 5174. D1 is the remote database, same as local dev.
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
    command:
      "npx wrangler d1 migrations apply DB --remote && npm run dev:e2e -- --port 5174",
    env: {
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
