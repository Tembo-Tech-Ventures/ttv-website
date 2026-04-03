import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
  integrations: [react(), tailwind()],
  vite: {
    resolve: {
      // Ensure Node.js built-ins resolve for Cloudflare nodejs_compat
      external: ["node:async_hooks", "node:crypto", "node:buffer", "node:path", "node:fs", "node:os", "node:util", "node:stream", "node:events", "node:net", "node:tls", "node:http", "node:https", "node:url", "node:zlib"],
    },
    ssr: {
      external: ["node:async_hooks", "node:crypto", "node:buffer", "node:path", "node:fs", "node:os", "node:util", "node:stream", "node:events", "node:net", "node:tls", "node:http", "node:https", "node:url", "node:zlib"],
    },
  },
});
