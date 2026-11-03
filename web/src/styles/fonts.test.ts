import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${SRC}/${path}`, "utf8");
const css = read("styles/global.css");
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  family: /font-family:\s*"([^"]+)"/.exec(body)?.[1],
  src: /src:\s*url\("\.\.\/([^"]+)"\)/.exec(body)?.[1],
  body,
}));

// Both faces are self-hosted: a cold load needs no second origin (PERF-3).
describe("the site's fonts", () => {
  it("come from this origin only", () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.filter((face) => !face.src || !existsSync(`${SRC}/${face.src}`))).toEqual([]);
  });

  it("keep Maven Pro's weights and swap behaviour, one file per subset", () => {
    const maven = faces.filter((face) => face.family === "Maven Pro");
    expect(maven.map((face) => face.src)).toEqual([
      "assets/fonts/MavenPro-latin.woff2",
      "assets/fonts/MavenPro-latin-ext.woff2",
      "assets/fonts/MavenPro-vietnamese.woff2",
    ]);
    for (const face of maven) {
      expect(face.body).toMatch(/font-weight:\s*400 700;/);
      expect(face.body).toMatch(/font-display:\s*swap;/);
      expect(face.body).toMatch(/unicode-range:/);
    }
  });

  it("preload the latin Maven Pro file in every document head", () => {
    expect(read("components/common/FontPreload.astro")).toContain('from "@/assets/fonts/MavenPro-latin.woff2?url"');
    const astroFiles = (dir: string): string[] => readdirSync(`${SRC}/${dir}`, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? astroFiles(`${dir}/${entry.name}`) : entry.name.endsWith(".astro") ? [`${dir}/${entry.name}`] : []);
    const heads = [...astroFiles("layouts"), ...astroFiles("components"), ...astroFiles("pages")].filter((file) => /^\s*<head>/m.test(read(file)));
    expect(heads.length).toBeGreaterThanOrEqual(5);
    expect(heads.filter((file) => !read(file).includes("<FontPreload />"))).toEqual([]);
  });
});
