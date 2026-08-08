import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";

const SRC = resolve(__dirname, "..");
const GLOBAL_CSS = join(SRC, "styles/global.css");
const css = readFileSync(GLOBAL_CSS, "utf8");

/** Source extensions that can carry markup with a `font-heading` class. */
const MARKUP_EXTENSIONS = [".astro", ".tsx"];

async function markupFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return markupFiles(path);
      return MARKUP_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) ? [path] : [];
    })
  );
  return found.flat();
}

/**
 * Slice out the opening tag that a `font-heading` occurrence sits inside, so
 * tracking on a display heading can be told apart from tracking on a body
 * element elsewhere in the same file. Scanning back to `<` and forward to `>`
 * can end the tag early if a prop value contains `>`, which risks missing a
 * violation but never invents one — the safe direction for a guard like this.
 */
function enclosingTag(source: string, index: number): string {
  const open = source.lastIndexOf("<", index);
  const close = source.indexOf(">", index);
  if (open === -1 || close === -1) return "";
  return source.slice(open, close + 1);
}

describe("display typeface", () => {
  it("points --font-heading at a family declared by a local @font-face", () => {
    const token = css.match(/--font-heading:\s*"([^"]+)"/);
    expect(token, "global.css must define --font-heading").not.toBeNull();

    const family = token![1];
    const face = new RegExp(`@font-face\\s*{[^}]*font-family:\\s*"${family}"[^}]*}`).exec(css);
    expect(face, `no @font-face declares "${family}"`).not.toBeNull();

    const src = face![0].match(/url\("([^"]+)"\)/);
    expect(src, "the @font-face must reference a font file").not.toBeNull();
    expect(src![1], "the display face must be self-hosted, not fetched from a CDN").not.toMatch(
      /^https?:/
    );

    // Resolved relative to global.css, the same way the bundler resolves it.
    const fontPath = resolve(dirname(GLOBAL_CSS), src![1]);
    expect(statSync(fontPath).size).toBeGreaterThan(1024);
  });

  it("ships the font's licence alongside it", () => {
    // Mattone is OFL 1.1, which requires the licence travel with the software.
    const licence = readFileSync(resolve(SRC, "assets/fonts/LICENSE.txt"), "utf8");
    expect(licence).toMatch(/SIL Open Font License/i);
  });

  it("no longer references the retired Climate Crisis face", () => {
    expect(css).not.toMatch(/Climate\+?\s?Crisis/i);
  });

  it("defines the three display tracking tokens", () => {
    for (const token of ["--tracking-display", "--tracking-heading", "--tracking-subhead"]) {
      expect(css, `${token} is missing`).toMatch(new RegExp(`${token}:\\s*-?[\\d.]+em`));
    }
  });
});

describe("display headings", () => {
  it("take tracking from the theme tokens, never inline letter-spacing", async () => {
    const files = await markupFiles(SRC);
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (let i = source.indexOf("font-heading"); i !== -1; i = source.indexOf("font-heading", i + 1)) {
        const tag = enclosingTag(source, i);
        if (/letter-spacing|letterSpacing/.test(tag)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
        }
      }
    }

    // Hand-tuned tracking is what made the last font swap a thirty-file change.
    expect(offenders).toEqual([]);
  });
});
