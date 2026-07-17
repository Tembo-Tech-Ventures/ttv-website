import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    coverage: {
      clean: true,
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportOnFailure: true,
      thresholds: {
        statements: 67,
        branches: 64,
        functions: 54,
        lines: 69,
        "src/lib/chat/{contracts,prompt,retrieval,service,stream}.ts": {
          statements: 85,
          branches: 70,
          functions: 85,
          lines: 85,
        },
      },
    },
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
