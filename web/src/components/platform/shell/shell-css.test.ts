import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The frame every signed-in page sits in draws its colours from the theme:
 * inks, the ground and peach through color-mix, shadows through the
 * --shadow-* tokens. A raw rgb() or hex here is a colour the guide does not
 * know about (style-guide rollout S1). Read from disk: Vitest empties CSS imports.
 */
const PLATFORM = join(process.cwd(), "src/components/platform");
const SHEETS = ["shell/spaces-shell.css", "search/search.css", "attention/attention.css"];
const read = (file: string) => readFileSync(join(PLATFORM, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** A box-shadow's layers: its commas outside parentheses. */
function layers(shadow: string): string[] {
  const parts = [""];
  let depth = 0;
  for (const char of shadow) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (char === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts.map((part) => part.trim());
}

describe("the shell's stylesheets", () => {
  it.each(SHEETS)("%s uses theme tokens, never a raw colour", (file) => {
    const css = read(file);
    expect(css.match(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b|:\s*(?:black|white)\b/gi) ?? []).toEqual([]);
  });

  it.each(SHEETS)("%s casts any drop shadow from a theme token", (file) => {
    const shadows = [...read(file).matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => match[1]!.replace(/\s+/g, " ").trim());
    for (const shadow of shadows) {
      // An inset hairline or edge is drawing, not depth; a drop shadow is a token.
      const drops = layers(shadow).filter((part) => !/\binset\b/.test(part));
      expect(drops.filter((part) => !/^var\(--shadow-[a-z-]+\)$/.test(part))).toEqual([]);
    }
  });

  it("dims the page behind the drawer with the ground, not an off-palette teal", () => {
    expect(read("shell/spaces-shell.css")).toMatch(/\.spaces-shell__scrim \{[^}]*background-color: color-mix\(in srgb, var\(--color-ground\) 60%, transparent\)/);
  });

  it("leaves the filters' look to the kit's Pill: no hand-rolled pill rules", () => {
    expect(read("search/search.css")).not.toMatch(/\.search-scope\s*[{[:]/);
    expect(read("attention/attention.css")).not.toMatch(/\.attention-filter\s*[{[:]/);
  });
});
