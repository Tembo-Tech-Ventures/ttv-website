import { defineConfig, devices } from "@playwright/test";

/**
 * The navigation measurements (web/docs/performance.md). One worker, nothing
 * else running, so numbers are not shared with the e2e suite's load. Results
 * land in test-results/perf/, which the preview's evidence upload keeps.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /\.perf\.ts$/,
  outputDir: "../../test-results/perf-playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 15 * 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4321",
    trace: "off",
    // No step may wait forever: a missing control fails the step, not the whole pass.
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
});
