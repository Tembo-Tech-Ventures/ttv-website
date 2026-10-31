import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rules about the primitives that are easiest to state about their source:
 * the brand colours come only from theme tokens, Mattone appears only in
 * Tembo's mark, letter-spacing comes only from the tracking tokens, and any
 * motion is limited to hover/focus transitions that reduced motion switches
 * off. The harness must not exist outside the dev server.
 */
const UI_DIR = import.meta.dirname;
const SOURCES = readdirSync(UI_DIR)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(UI_DIR, name), "utf8") }));

function offenders(pattern: RegExp, except: string[] = []) {
  return SOURCES.filter(({ name, text }) => !except.includes(name) && pattern.test(text)).map(({ name }) => name);
}

describe("platform primitive sources", () => {
  it("covers every primitive", () => {
    const names = SOURCES.map(({ name }) => name);
    for (const primitive of [
      "Avatar.tsx",
      "Button.tsx",
      "Card.tsx",
      "Icon.tsx",
      "CountBadge.tsx",
      "IconButton.tsx",
      "PersonMarker.tsx",
      "Pill.tsx",
      "RoleBadge.tsx",
      "Sheet.tsx",
      "SpaceTabs.tsx",
      "TemboMark.tsx",
      "TextReaction.tsx",
    ]) {
      expect(names).toContain(primitive);
    }
  });

  it("takes every colour from the theme tokens: no hex, rgb or named Tailwind palette", () => {
    expect(offenders(/#[0-9a-f]{3,8}\b/i)).toEqual([]);
    expect(offenders(/\b(?:bg|text|border|ring|outline)-(?:red|green|blue|yellow|gray|slate|white|black|emerald|rose)\b/)).toEqual([]);
    // Shadows use black or warm-white hairlines only.
    const rgb = SOURCES.flatMap(({ text }) => text.match(/rgb\([^)]*\)/g) ?? []);
    for (const value of rgb) expect(value).toMatch(/^rgb\((?:0_0_0|255_248_242)\/0\.\d+\)$/);
  });

  it("uses the display face only for Tembo's mark", () => {
    expect(offenders(/font-heading|Mattone/, ["TemboMark.tsx"])).toEqual([]);
  });

  it("never sets letter-spacing by hand", () => {
    expect(offenders(/letterSpacing|letter-spacing|tracking-\[/)).toEqual([]);
  });

  it("moves only by colour transitions that reduced motion turns off", () => {
    for (const { name, text } of SOURCES) {
      const transitions = text.match(/(?<![\w:-])transition-[a-z]+/g) ?? [];
      for (const transition of transitions) expect(transition, `${name}`).toBe("transition-colors");
      if (transitions.length > 0) expect(text, `${name}`).toContain("motion-reduce:transition-none");
      // The loading spinner is the only animation, and only with motion allowed.
      for (const animation of text.match(/[\w:-]*animate-[a-z]+/g) ?? []) {
        expect(animation, `${name}`).toBe("motion-safe:animate-spin");
      }
    }
  });

  it("never uses emoji for reactions", () => {
    const reactions = SOURCES.find(({ name }) => name === "TextReaction.tsx")!.text;
    expect(reactions).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("/dev/platform-ui", () => {
  const page = readFileSync(join(UI_DIR, "../../../pages/dev/platform-ui.astro"), "utf8");
  const frontmatter = page.split("---")[1];

  it("answers 404 outside the dev server, before doing anything else", () => {
    const code = frontmatter
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^import [\s\S]*?;$/gm, "")
      .trim();
    expect(code.startsWith('if (!import.meta.env.DEV) {\n  return new Response("Not found", { status: 404 });\n}')).toBe(
      true
    );
  });

  it("is never indexed", () => {
    expect(page).toContain("<BaseLayout title=\"Platform UI | TTV\" noIndex>");
  });

  it("uses Mattone for its one h1 only", () => {
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    for (const h2 of page.match(/<h2\b[^>]*>/g) ?? []) expect(h2).toMatch(/font-body|sectionTitle/);
  });
});
