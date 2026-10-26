import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "organizer.browser.ts",
  use: {
    baseURL: "http://127.0.0.1:4322",
    browserName: "chromium",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "npx vite --config organizer-preview.config.ts",
    url: "http://127.0.0.1:4322",
    reuseExistingServer: !process.env.CI,
  },
});
