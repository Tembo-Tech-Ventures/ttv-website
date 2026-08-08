import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Canonical origin. Certificates print their own verification URL, which must
  // name the public domain rather than whichever host served the request.
  site: "https://tembotechventures.com",
  adapter: cloudflare(),
  integrations: [react()],
  output: "server",
  vite: {
    plugins: [tailwindcss()],
  },
});
