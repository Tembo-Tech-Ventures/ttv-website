import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// A browser test harness for the real components, not an alternate app runtime.
// Production Astro/Cloudflare configuration and bindings remain untouched.
const config = {
  // Vite 8 uses Oxc rather than esbuild. Transform Astro's preserved JSX before
  // import analysis; older Vite versions ignore this option.
  oxc: { jsx: { runtime: "automatic" as const } },
  root: fileURLToPath(new URL("./component-preview", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  plugins: [tailwindcss()],
  server: { host: "127.0.0.1", port: 4322, strictPort: true },
};

export default defineConfig(config);
