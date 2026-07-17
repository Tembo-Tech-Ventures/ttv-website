import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("recording UI accessibility contract", () => {
  it("ships a captions track with the admin video preview", async () => {
    const page = await readFile(
      path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "pages",
        "admin",
        "recordings",
        "[id].astro"
      ),
      "utf8"
    );

    expect(page).toContain('kind="captions"');
    expect(page).toContain("src={captionTrackUrl}");
    expect(page).toContain('srclang="en"');
    expect(page).toContain("encodeURIComponent(captionText)");
  });
});
