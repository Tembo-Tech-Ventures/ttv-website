import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseLayout = readFileSync(new URL("../layouts/BaseLayout.astro", import.meta.url), "utf8");
const favicon = readFileSync(new URL("../../public/favicon.svg", import.meta.url), "utf8");

describe("public assets", () => {
  it("ships the favicon referenced by the base layout", () => {
    expect(baseLayout).toContain('href="/favicon.svg"');
    expect(favicon).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
  });
});
