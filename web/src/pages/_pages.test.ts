import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Astro routes every file under src/pages except the ones whose name starts
// with "_". A routed test would ship vitest in the Worker and answer at a
// public URL (until November 2026, /api/chat.test returned a 500).
it("keeps test files out of the routes", () => {
  const pages = fileURLToPath(new URL(".", import.meta.url));
  const routedTests = readdirSync(pages, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path))
    .filter((path) => !path.split("/").some((segment) => segment.startsWith("_")));
  expect(routedTests).toEqual([]);
});
