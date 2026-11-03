import { defineConfig, devices } from "@playwright/test";

/**
 * PERF-1 (investigation branch only): the navigation measurements. One worker,
 * nothing else running, so numbers are not shared with the e2e suite's load.
 * Results land in test-results/perf/, which the preview's evidence upload keeps.
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
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
});
