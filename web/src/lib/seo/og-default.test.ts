import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("default Open Graph image", () => {
  it("is a 1200 by 630 PNG", () => {
    const image = readFileSync(new URL("../../../public/og-default.png", import.meta.url));
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  });
});
