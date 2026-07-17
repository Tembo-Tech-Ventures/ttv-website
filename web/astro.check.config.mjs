import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Type checking must not create a Cloudflare remote binding proxy. Production
// and development continue to use astro.config.mjs with the Cloudflare adapter;
// this config exists solely for the credential-free `astro check` quality gate.
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
