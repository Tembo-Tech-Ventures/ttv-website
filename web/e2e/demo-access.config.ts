import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir:".",testMatch:"demo-access.browser.ts",
  use:{baseURL:"http://127.0.0.1:4322",browserName:"chromium",reducedMotion:"reduce",trace:"off"},
  webServer:{command:"npx vite --config community-preview.config.ts",url:"http://127.0.0.1:4322",reuseExistingServer:!process.env.CI},
});
