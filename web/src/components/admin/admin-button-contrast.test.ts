import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * White words on a solid Tailwind colour in the admin pages ("Approve
 * selected" on /admin/programs/[id] was white on green-600, 3.2:1, QA2-07)
 * must clear 4.5:1. The colours are read from Tailwind's own theme, so a
 * palette change recomputes rather than drifting.
 */
const ROOT = resolve(__dirname, "../../..");
const ADMIN_PAGES = join(ROOT, "src/pages/admin");
const THEME = readFileSync(join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8");
const AA = 4.5;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith(".astro") ? [path] : [];
  });
}

/** Linear-light sRGB from Tailwind's oklch() (Björn Ottosson's OKLab matrices), clamped to the gamut. */
function linearRgb(colour: string): [number, number, number] {
  const match = /oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(colour);
  if (!match) throw new Error(`Cannot read ${colour}`);
  const [lightness, chroma, hue] = [Number(match[1]) / 100, Number(match[2]), (Number(match[3]) * Math.PI) / 180];
  const [a, b] = [chroma * Math.cos(hue), chroma * Math.sin(hue)];
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function againstWhite(name: string): number {
  const value = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(THEME)?.[1];
  if (!value) throw new Error(`--color-${name} is not in Tailwind's theme`);
  const [r, g, b] = linearRgb(value.trim());
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

type Use = { where: string; background: string };

/**
 * Every class set in a page with white text on a solid palette background, at rest and on hover: each
 * quoted string (an attribute, or a lookup table's entry), and each class:list taken whole, since its
 * text colour and its background can sit in different entries.
 */
function whiteOnColour(where: string, source: string): Use[] {
  const strings = (text: string) => [...text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map((match) => match[1] ?? match[2] ?? "");
  const sets = [
    ...strings(source).map((text) => text.split(/\s+/)),
    ...[...source.matchAll(/class:list=\{\[([\s\S]*?)\]\}/g)].map((match) => strings(match[1]).flatMap((text) => text.split(/\s+/))),
  ];
  return sets
    .filter((classes) => classes.includes("text-white"))
    .flatMap((classes) => classes.flatMap((name) => {
      const background = /^(?:hover:)?bg-([a-z]+-\d{2,3})$/.exec(name)?.[1];
      return background ? [{ where: `${where} ${name}`, background }] : [];
    }));
}

const adminUses = () => files(ADMIN_PAGES).flatMap((path) => whiteOnColour(relative(ROOT, path), readFileSync(path, "utf8")));
const failing = (uses: Use[]) => uses
  .map(({ where, background }) => ({ where, ratio: Number(againstWhite(background).toFixed(2)) }))
  .filter(({ ratio }) => ratio < AA);

describe("admin buttons with white words on a solid colour", () => {
  it("are looked for in every admin page, so this test reads the pages it means to", () => {
    // Pages leave this list as they move to the kit, whose buttons are proven in contrast.test.ts;
    // the class:list case below proves the detector itself.
    expect(files(ADMIN_PAGES).length).toBeGreaterThan(25);
  });

  it("are caught when white and the background sit in different class:list entries", () => {
    const split = `<button class:list={["px-4 text-white", published ? "bg-red-700" : "bg-green-600 hover:bg-green-700"]}>`;
    expect(failing(whiteOnColour("fixture", split)).map(({ where }) => where)).toEqual(["fixture bg-green-600"]);
  });

  it("clear 4.5:1 at rest and on hover (QA2-07)", () => {
    expect(failing(adminUses())).toEqual([]);
  });
});
