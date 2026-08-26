import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../../pages/admin/recordings/import.astro", import.meta.url),
  "utf8"
);

describe("Drive historical import page", () => {
  it("uses an explicit review and confirmed import flow", () => {
    expect(pageSource).toContain('name="action" value="preview"');
    expect(pageSource).toContain('name="action" value="confirm"');
    expect(pageSource).toContain('name="expectedImportable"');
    expect(pageSource).toContain("previewRecordingImportSource");
    expect(pageSource).toContain("expectedImportable,");
    expect(pageSource).toContain("enabled: false");
    expect(pageSource).toContain("New sources start");
    expect(pageSource).not.toContain('name="action" value="sync"');
  });

  it("shows the historical scan breakdown and explains the rescan guard", () => {
    expect(pageSource).toContain('data-testid="historical-import-preview"');
    expect(pageSource).toContain("Videos found");
    expect(pageSource).toContain("New videos");
    expect(pageSource).toContain("Pending retry");
    expect(pageSource).toContain("Already in TTV");
    expect(pageSource).toMatch(/If the count\s+changed/);
  });
});
