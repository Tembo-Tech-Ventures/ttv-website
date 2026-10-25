import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = new URL("../public/images/demo/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8"));
const provenance = JSON.parse(readFileSync(new URL("../../docs/hackathon/demo-images-2026-10-25/provenance.json", import.meta.url), "utf8"));
const assets = [...manifest.portraits, ...manifest.contexts];

describe("fictional demo image delivery contract", () => {
  it("separates seven reusable portraits from three institution contexts", () => {
    expect(manifest.version).toBe(1);
    expect(manifest.synthetic).toBe(true);
    expect(manifest.disclosure).toContain("do not identify real community members");
    expect(manifest.portraits).toHaveLength(7);
    expect(manifest.contexts).toHaveLength(3);
    expect(new Set(assets.map(({ id }) => id)).size).toBe(10);
    expect(manifest.portraits.every(({ id, width, height }) => id.startsWith("portrait-") && width === 384 && height === 384)).toBe(true);
    expect(manifest.contexts.every(({ id, width, height }) => id.startsWith("context-") && width === 768 && height === 512)).toBe(true);
  });

  it.each(assets)("ships local optimized WebP and JPEG fallback for $id", (asset) => {
    expect(asset.src).toBe(`/images/demo/${asset.id}.webp`);
    expect(asset.fallback).toBe(`/images/demo/${asset.id}.jpg`);
    const webp = readFileSync(new URL(`${asset.id}.webp`, directory));
    const jpeg = readFileSync(new URL(`${asset.id}.jpg`, directory));
    expect(webp.subarray(0, 4).toString()).toBe("RIFF");
    expect(webp.subarray(8, 12).toString()).toBe("WEBP");
    expect(jpeg.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect(webp.length).toBe(asset.bytes);
    expect(jpeg.length).toBe(asset.fallbackBytes);
    expect(webp.length).toBeLessThan(asset.id.startsWith("portrait-") ? 25000 : 85000);
    expect(jpeg.length).toBeLessThan(asset.id.startsWith("portrait-") ? 32000 : 105000);
    expect(asset.alt).toMatch(/^AI-generated fictional demo image/);
    expect(asset.alt).toContain("not a real person or institution");
    expect(asset.provenance).toBe("AI-generated");
    const record = provenance.find(({ id }) => id === asset.id);
    expect(record.tool).toBe("Codex image_gen.imagegen");
    expect(record.prompt).toContain("fictional");
    expect(record.prompt.length).toBeGreaterThan(100);
  });

  it("contains only listed derivatives and stays under the combined transfer budget", () => {
    expect(readdirSync(directory).toSorted()).toEqual(["manifest.json", ...assets.flatMap(({ id }) => [`${id}.webp`, `${id}.jpg`])].toSorted());
    expect(assets.reduce((total, asset) => total + asset.bytes + asset.fallbackBytes, 0)).toBeLessThan(700000);
    expect(provenance).toHaveLength(10);
  });
});
