import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    globals: true,
    environment: "node",
    // Vitest empties CSS imports, even `?raw` ones, unless they are included here. The design
    // tokens (src/lib/design/tokens.ts) read global.css as text, so that one file is let through.
    css: { include: [/global\.css/] },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    // .astro render tests compile through Astro's Vite setup (vitest.render.config.ts).
    exclude: [...configDefaults.exclude, "src/**/*.render.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
});
