import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /talent-integration/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testIgnore: /talent-integration/,
    },
    {
      // The cross-feature journey publishes the preview user's profile, which
      // the per-feature suites assert against (e.g. the opportunities gate),
      // so it must run only after both parallel projects complete.
      name: "integration",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /talent-integration/,
      dependencies: ["chromium", "mobile-chromium"],
    },
  ],
});
