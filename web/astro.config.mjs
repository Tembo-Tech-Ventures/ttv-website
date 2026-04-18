import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  adapter: cloudflare(),
  integrations: [react()],
  output: "server",
  vite: {
    plugins: [tailwindcss()],
  },
});
