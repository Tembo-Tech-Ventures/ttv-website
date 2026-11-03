import react from "@astrojs/react";
import { getViteConfig } from "astro/config";

/**
 * Tests that render .astro components with Astro's container API (`*.render.test.ts`). They compile
 * through Astro's own Vite setup, without astro.config.mjs: the Cloudflare adapter would run them in
 * workerd. React is the only renderer the admin shell needs.
 */
export default getViteConfig(
  { test: { environment: "node", include: ["src/**/*.render.test.ts"] } },
  { configFile: false, integrations: [react()] },
);
