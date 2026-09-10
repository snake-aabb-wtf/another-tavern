import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const e2eDatabase = resolve("e2e/.tmp/browser-e2e.db");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === "true" ? 2 : 0,
  reporter:
    process.env.CI === "true"
      ? [["line"], ["html", { open: "never", outputFolder: "playwright-report" }]]
      : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      command: "node scripts/e2e/fake-upstream.mjs",
      url: "http://127.0.0.1:4010/health",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @another-tavern/server dev",
      url: "http://127.0.0.1:3001/api/health",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        HOST: "127.0.0.1",
        PORT: "3001",
        DB_PATH: e2eDatabase,
      },
    },
    {
      command: "pnpm --filter @another-tavern/web dev -- --host 127.0.0.1 --port 5173",
      url: "http://localhost:5173",
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
