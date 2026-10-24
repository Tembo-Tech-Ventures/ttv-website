import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// A browser test harness for the real components, not an alternate app runtime.
// Production Astro/Cloudflare configuration and bindings remain untouched.
export default defineConfig({
  root: fileURLToPath(new URL("./component-preview", import.meta.url)),
  plugins: [tailwindcss()],
  server: { host: "127.0.0.1", port: 4322, strictPort: true },
});
