import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "community-assessment.spec.ts",
    "community-workspace.spec.ts",
    "staging-community-journey.spec.mjs",
    "feedback-error.spec.ts",
    "community-entry.spec.ts",
  ],
  fullyParallel: true,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:4322", screenshot: "only-on-failure" },
  webServer: {
    command: "npx vite --config community-preview.config.ts",
    url: "http://127.0.0.1:4322",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
