import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("BaseLayout public assets", () => {
  it("ships the favicon referenced by the document head", async () => {
    const layout = await readFile(new URL("./BaseLayout.astro", import.meta.url), "utf8");
    const faviconHref = layout.match(
      /<link rel="icon" type="image\/svg\+xml" href="([^"]+)" \/>/
    )?.[1];

    expect(faviconHref).toBe("/favicon.svg");

    const favicon = await readFile(
      new URL(`../../public${faviconHref}`, import.meta.url),
      "utf8"
    );

    expect(favicon).toContain("<svg");
    expect(favicon).toContain('viewBox="0 0 64 64"');
    expect(favicon).toContain("Tembo Tech Ventures");
  });
});
