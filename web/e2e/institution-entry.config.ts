import { defineConfig } from "@playwright/test";
export default defineConfig({testDir: ".", testMatch: "institution-entry.browser.ts", use: {baseURL: "http://127.0.0.1:4322", browserName: "chromium"}, webServer: {command: "npx vite --config community-preview.config.ts", url: "http://127.0.0.1:4322", reuseExistingServer: !process.env.CI}});
