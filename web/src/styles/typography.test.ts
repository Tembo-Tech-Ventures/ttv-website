import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";

const SRC = resolve(__dirname, "..");
const GLOBAL_CSS = join(SRC, "styles/global.css");
const css = readFileSync(GLOBAL_CSS, "utf8");

/** Source extensions that can carry markup with a `font-heading` or `font-display` class. */
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
 * Slice out the opening tag that a display-face class sits inside, so
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

  it("names the display face as a role, font-display, for the public site's display h2s", () => {
    expect(css).toMatch(/--font-display:\s*var\(--font-heading\);/);
  });

  it("defines the three display tracking tokens", () => {
    for (const token of ["--tracking-display", "--tracking-heading", "--tracking-subhead"]) {
      expect(css, `${token} is missing`).toMatch(new RegExp(`${token}:\\s*-?[\\d.]+em`));
    }
  });
});

/** The base layer's declarations for one selector list, exactly as written in global.css. */
function baseRule(selector: string): string {
  const base = /@layer base\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? "";
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*{([^}]*)}`).exec(base)?.[1] ?? "";
}

describe("heading base styles", () => {
  it("give the display face to the h1 alone, the page's one title", () => {
    expect(baseRule("h1")).toMatch(/font-family:\s*var\(--font-heading\)/);
  });

  it("set every other heading, h2 included, in Maven Pro bold, so a section heading needs no class", () => {
    const rule = baseRule("h2, h3, h4, h5, h6");
    expect(rule).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(rule).toMatch(/font-weight:\s*700/);
  });

  it("are not patched again further down: no stylesheet resets the h2 for the platform", async () => {
    const sheets = await cssFiles(SRC);
    const patches = sheets.filter((file) => /(^|[\s,}])\.spaces-shell__main h2\s*{/.test(readFileSync(file, "utf8")));
    expect(patches).toEqual([]);
  });
});

describe("display headings", () => {
  it("say font-display when an h2 takes the display face, never font-heading", async () => {
    const files = await markupFiles(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<h2\b[^>]*>/g)) {
        if (/\bfont-heading\b/.test(match[0])) offenders.push(`${file.slice(SRC.length + 1)}: ${match[0].replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("take tracking from the theme tokens, never inline letter-spacing", async () => {
    const files = await markupFiles(SRC);
    const offenders: string[] = [];

    for (const file of files) {
      // Style and script bodies are not markup; CSS is checked rule by rule below.
      const source = readFileSync(file, "utf8").replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, "");
      for (const match of source.matchAll(/\bfont-(heading|display)\b/g)) {
        const tag = enclosingTag(source, match.index);
        if (/letter-spacing|letterSpacing/.test(tag)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`);
        }
      }
    }

    // Hand-tuned tracking is what made the last font swap a thirty-file change.
    expect(offenders).toEqual([]);
  });

  it("use the tracking tokens in any CSS rule that sets the display face", async () => {
    const files = await markupFiles(SRC);
    const sheets = await cssFiles(SRC);
    const offenders: string[] = [];
    for (const file of [...files, ...sheets]) {
      const source = readFileSync(file, "utf8");
      const styles = file.endsWith(".css")
        ? source
        : [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
      for (const rule of displayRules(styles)) {
        const spacing = /letter-spacing:\s*([^;]+)/.exec(rule.body);
        if (spacing && !/^var\(--tracking-(display|heading|subhead)\)$/.test(spacing[1].trim())) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${rule.selector} { letter-spacing: ${spacing[1].trim()} }`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

async function cssFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return cssFiles(path);
      return entry.name.endsWith(".css") && path !== GLOBAL_CSS ? [path] : [];
    })
  );
  return found.flat();
}

/** Innermost CSS rules whose declarations set the display font family. */
function displayRules(styles: string): Array<{ selector: string; body: string }> {
  const stripped = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim().replace(/\s+/g, " "), body: match[2] }))
    .filter((rule) => /font-family:\s*var\(--font-heading\)/.test(rule.body));
}
