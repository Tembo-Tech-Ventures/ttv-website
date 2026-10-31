import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { AVATAR_PALETTE } from "./avatar-colour";
import { SPACES } from "./spaces";
import { CHIP_TONES, RAISED, type ChipTone } from "./tones";

/**
 * Every word the primitives draw has to clear 4.5:1 on every surface it can
 * land on, and those surfaces multiply: six sheet tones, a raised card on
 * each, chips and hover tints on both. The worst cases are the lighter sheets
 * with a tint on a card, which is where earlier drafts of these tokens failed.
 *
 * The numbers here are read from the source rather than restated: tokens from
 * global.css, tint strengths from the class names the components actually use.
 * Change a token or a tint and this recomputes; it cannot drift out of date.
 */
const HERE = resolve(__dirname);
const GLOBAL_CSS = readFileSync(resolve(HERE, "../../../styles/global.css"), "utf8");
const PLATFORM_CSS = readFileSync(join(HERE, "platform-ui.css"), "utf8");
const AA = 4.5;

type Rgb = [number, number, number];

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(GLOBAL_CSS);
  if (!match) throw new Error(`--color-${name} is not defined in global.css`);
  return match[1].trim();
}

function parse(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) throw new Error(`Cannot parse colour: ${value}`);
  return { rgb: [Number(parts[0]), Number(parts[1]), Number(parts[2])], alpha: Number(parts[3] ?? 1) };
}

/** `top` at `alpha` laid over the opaque `base`. */
function over(top: Rgb, alpha: number, base: Rgb): Rgb {
  return top.map((c, i) => alpha * c + (1 - alpha) * base[i]) as Rgb;
}

function luminance([r, g, b]: Rgb) {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb) {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink colour, composited onto the surface when the token is translucent. */
function ink(name: string, surface: Rgb): Rgb {
  const { rgb, alpha } = parse(token(name));
  return over(rgb, alpha, surface);
}

/** "bg-ring/8" → { colour: "ring", alpha: 0.08 }. */
function tint(classes: string) {
  const match = /\bbg-([a-z-]+)\/(\d+)\b/.exec(classes);
  if (!match) throw new Error(`No translucent background in "${classes}"`);
  return { colour: match[1], alpha: Number(match[2]) / 100 };
}

function textToken(classes: string) {
  const match = /\btext-((?:ink|peach|ring|danger)[a-z-]*)\b/.exec(classes);
  if (!match) throw new Error(`No text colour in "${classes}"`);
  return match[1];
}

function lay(classes: string, base: Rgb): Rgb {
  const { colour, alpha } = tint(classes);
  return over(parse(token(colour)).rgb, alpha, base);
}

/** The strongest `hover:bg-<colour>/<n>` tint any primitive lays under its text. */
function strongestHover(colour: string) {
  const sources = readdirSync(HERE)
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => readFileSync(join(HERE, file), "utf8"))
    .join("\n");
  const pattern = new RegExp(`hover:bg-${colour}/(\\d+)`, "g");
  const alphas = [...sources.matchAll(pattern)].map((m) => Number(m[1]) / 100);
  expect(alphas.length, `expected hover:bg-${colour} tints in the primitives`).toBeGreaterThan(0);
  return Math.max(...alphas);
}

const INACTIVE_TAB_SHARE = Number(/var\(--space-tone\) (\d+)%, var\(--color-ground\)/.exec(PLATFORM_CSS)?.[1]) / 100;

describe.each(SPACES)("the %s sheet", (space) => {
  const sheet = parse(token(`sheet-${space}`)).rgb;
  const raised = lay(RAISED, sheet);
  const bases = { sheet, card: raised } as const;

  describe.each(Object.entries(bases))("on the %s", (_, base) => {
    it.each(["ink-primary", "ink-secondary", "ink-muted", "peach-ink", "ring", "danger-ink"])(
      "%s clears 4.5:1",
      (name) => {
        expect(contrast(ink(name, base), base)).toBeGreaterThanOrEqual(AA);
      },
    );

    it.each(Object.keys(CHIP_TONES) as ChipTone[])("a %s chip's text clears 4.5:1", (tone) => {
      const surface = lay(CHIP_TONES[tone], base);
      expect(contrast(ink(textToken(CHIP_TONES[tone]), surface), surface)).toBeGreaterThanOrEqual(AA);
    });

    it("a quiet reaction's text clears 4.5:1 on its own lift", () => {
      const surface = lay(RAISED, base);
      expect(contrast(ink("ink-secondary", surface), surface)).toBeGreaterThanOrEqual(AA);
    });

    // Hovers that brighten a control keep or lift its ink to ink-primary;
    // the danger button tints with its own colour instead.
    it("ink-primary stays readable under the strongest hover", () => {
      const surface = over(parse(token("ink-primary")).rgb, strongestHover("ink-primary"), base);
      expect(contrast(ink("ink-primary", surface), surface)).toBeGreaterThanOrEqual(AA);
    });

    it("danger-ink stays readable under its hover", () => {
      const surface = over(parse(token("danger-ink")).rgb, strongestHover("danger-ink"), base);
      expect(contrast(ink("danger-ink", surface), surface)).toBeGreaterThanOrEqual(AA);
    });
  });

  it("an inactive tab of this tone reads at 4.5:1", () => {
    expect(INACTIVE_TAB_SHARE).toBeGreaterThan(0);
    const tab = over(sheet, INACTIVE_TAB_SHARE, parse(token("ground")).rgb);
    expect(contrast(ink("ink-secondary", tab), tab)).toBeGreaterThanOrEqual(AA);
  });
});

describe("solid fills", () => {
  const dark = parse(token("dark")).rgb;

  it.each(AVATAR_PALETTE)("initials are readable on %s", (colour) => {
    expect(contrast(dark, parse(colour).rgb)).toBeGreaterThanOrEqual(AA);
  });

  it.each(["primary", "peach-ink"])("dark teal reads on a %s button and badge", (name) => {
    expect(contrast(dark, parse(token(name)).rgb)).toBeGreaterThanOrEqual(AA);
  });

  it("Tembo's peach T reads on its dark teal disc", () => {
    expect(contrast(parse(token("primary")).rgb, dark)).toBeGreaterThanOrEqual(AA);
  });
});

describe("the sheet tones", () => {
  it("are all different, so every space is recognisable", () => {
    const values = SPACES.map((space) => token(`sheet-${space}`).toUpperCase());
    expect(new Set(values).size).toBe(SPACES.length);
  });

  it("each have a tone rule in platform-ui.css", () => {
    for (const space of SPACES) {
      expect(PLATFORM_CSS).toContain(`[data-space-tone="${space}"] { --space-tone: var(--color-sheet-${space}); }`);
    }
  });
});

describe("chip inks", () => {
  it("never use the muted ink, which is only cleared on bare sheets and cards", () => {
    for (const classes of Object.values(CHIP_TONES)) {
      expect(classes).not.toContain("text-ink-muted");
    }
  });
});
