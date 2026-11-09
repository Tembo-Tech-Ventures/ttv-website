import { describe, expect, it } from "vitest";
import { contrast, over, parseColour, type Rgb } from "@/lib/design/contrast";
import { colourToken } from "@/lib/design/tokens";
import { POST_EDITOR_THEME } from "./theme";

/*
 * The editor writes on the Profile sheet (the immersive editor, since #413), so every colour it
 * gives text, a link or a list marker has to read there: 4.5:1 or better, on the background the
 * node draws itself if it has one. Peach is too dark on the sheets; its text is the peach ink.
 */
const SHEET = parseColour(colourToken("sheet-profile")).rgb;

function token(name: string): Rgb | null {
  try {
    return parseColour(colourToken(name)).rgb;
  } catch {
    return null; // a size (text-lg) or an arbitrary value, not a colour
  }
}

function entries(value: unknown, path: string): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => entries(item, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => entries(item, path ? `${path}.${key}` : key));
  return [];
}

describe("the post editor's theme", () => {
  const nodes = entries(POST_EDITOR_THEME, "");

  it("keeps the brand peach out of text, links and list markers", () => {
    for (const [path, classes] of nodes) {
      expect(classes, `${path}`).not.toMatch(/(?:^|\s|:)text-primary\b/);
    }
  });

  it("gives every text colour 4.5:1 on the Profile sheet, or on the node's own background", () => {
    let checked = 0;
    for (const [path, classes] of nodes) {
      const background = /(?:^|\s)bg-([a-z-]+)(?:\/(\d+))?(?=\s|$)/.exec(classes);
      const fill = background && token(background[1]);
      const surface = fill ? over(fill, Number(background[2] ?? 100) / 100, SHEET) : SHEET;
      for (const [, name, alpha] of classes.matchAll(/(?:^|\s)(?:marker:)?text-([a-z-]+)(?:\/(\d+))?(?=\s|$)/g)) {
        const ink = token(name);
        if (!ink) continue;
        checked += 1;
        const ratio = contrast(over(ink, Number(alpha ?? 100) / 100, surface), surface);
        expect(ratio, `${path}: text-${name}${alpha ? `/${alpha}` : ""} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});
