import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const PUBLIC = resolve(SRC, "..", "public");
const HISTORICAL_ELEPHANT_ICON_SHA256 =
  "74a0d508120653c5e67669c11a23547f8ab9f695660c955a91f0f557acb134ba";

describe("site favicon", () => {
  it("uses the restored elephant PNG in every HTML layout", () => {
    for (const layout of ["BaseLayout.astro", "ImmersiveLayout.astro"]) {
      const source = readFileSync(resolve(SRC, "layouts", layout), "utf8");

      expect(source).toContain(
        '<link rel="icon" type="image/png" href="/favicon.png" />'
      );
      expect(source).not.toContain("/favicon.svg");
    }
  });

  it("keeps the favicon pinned to the recovered historical elephant icon", () => {
    const favicon = readFileSync(resolve(PUBLIC, "favicon.png"));
    const digest = createHash("sha256").update(favicon).digest("hex");

    expect(digest).toBe(HISTORICAL_ELEPHANT_ICON_SHA256);
  });

  it("does not leave the newer SVG T-mark favicon as a competing public asset", () => {
    expect(existsSync(resolve(PUBLIC, "favicon.svg"))).toBe(false);
  });
});
