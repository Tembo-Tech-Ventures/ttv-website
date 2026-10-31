import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVATAR_FILLS,
  CHIP_NEUTRAL_BG,
  CHIP_PEACH_BG,
  CHIP_RING_BG,
  DANGER_BG,
  DANGER_HOVER_BG,
  RAISED_BG,
  RAISED_HOVER_BG,
  SPACE_ORDER,
} from "./tokens";

/**
 * Every platform ink, composited over every surface it is allowed on, on every
 * space tone: the sheet itself, a raised card on the sheet, a chip on the
 * sheet, and a chip on a card. Translucent layers make the real background
 * depend on what is underneath, so this works the stack out rather than
 * checking one representative pair. The tint percentages are read from the
 * same class strings the components use.
 *
 * The browser spec repeats a sample of these on rendered pixels; this is the
 * exhaustive version.
 */
const CSS = readFileSync(join(import.meta.dirname, "../../../styles/global.css"), "utf8");
const AA = 4.5;

type Rgb = [number, number, number];
interface Colour {
  rgb: Rgb;
  alpha: number;
}

function token(name: string): Colour {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(CSS);
  if (!match) throw new Error(`--color-${name} is not defined in global.css`);
  return parse(match[1].trim());
}

function parse(value: string): Colour {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const parts = value.match(/[\d.]+/g)?.map(Number);
  if (!value.startsWith("rgba") || parts?.length !== 4) throw new Error(`Cannot parse colour: ${value}`);
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] };
}

/** "bg-primary/8" (or "hover:bg-primary/8") → the primary colour at 8%. */
function tint(className: string): Colour {
  const match = /(?:^|:)bg-([a-z-]+)\/(\d+)$/.exec(className);
  if (!match) throw new Error(`Not a tint class: ${className}`);
  return { rgb: token(match[1]).rgb, alpha: Number(match[2]) / 100 };
}

function over(top: Colour, base: Rgb): Rgb {
  return top.rgb.map((c, i) => top.alpha * c + (1 - top.alpha) * base[i]) as Rgb;
}

function luminance(rgb: Rgb) {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(ink: Colour, surface: Rgb) {
  const [hi, lo] = [luminance(over(ink, surface)), luminance(surface)].toSorted((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** A layer stack, bottom first, as the eye finally sees it. */
function stack(base: Rgb, ...layers: Colour[]): Rgb {
  return layers.reduce((under, layer) => over(layer, under), base);
}

const raised = tint(RAISED_BG);

/** Every surface text can land on, for one tone, named for the failure message. */
function surfaces(tone: (typeof SPACE_ORDER)[number]) {
  const sheet = token(`sheet-${tone}`).rgb;
  const card = stack(sheet, raised);
  return { sheet, card };
}

/** Ink on its chip, on the sheet and on a card. */
const CHIPS = [
  { name: "neutral chip", bg: CHIP_NEUTRAL_BG, inks: ["ink-primary", "sheet-ink-secondary"] },
  { name: "peach chip", bg: CHIP_PEACH_BG, inks: ["peach-ink"] },
  { name: "ring chip", bg: CHIP_RING_BG, inks: ["ring"] },
  { name: "danger button", bg: DANGER_BG, inks: ["danger-ink"] },
  { name: "hovered danger button", bg: DANGER_HOVER_BG, inks: ["danger-ink"] },
  // An unpicked reaction is a raised chip; on a card that is two lifts.
  { name: "reaction", bg: RAISED_BG, inks: ["sheet-ink-secondary"] },
  { name: "hovered reaction", bg: RAISED_HOVER_BG, inks: ["ink-primary"] },
] as const;

const PLAIN_INKS = ["ink-primary", "sheet-ink-secondary", "sheet-ink-muted", "peach-ink", "ring", "danger-ink"];

describe("platform text contrast", () => {
  for (const tone of SPACE_ORDER) {
    const { sheet, card } = surfaces(tone);

    for (const ink of PLAIN_INKS) {
      it(`${ink} is AA on the ${tone} sheet and on a card on it`, () => {
        for (const [where, surface] of [["sheet", sheet], ["card", card]] as const) {
          const ratio = contrast(token(ink), surface);
          expect(ratio, `${ink} on ${tone} ${where}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
        }
      });
    }

    for (const chip of CHIPS) {
      it(`${chip.name} text is AA on the ${tone} sheet and on a card on it`, () => {
        for (const [where, surface] of [["sheet", sheet], ["card", card]] as const) {
          const background = stack(surface, tint(chip.bg));
          for (const ink of chip.inks) {
            const ratio = contrast(token(ink), background);
            expect(ratio, `${ink} in ${chip.name} on ${tone} ${where}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
          }
        }
      });
    }

    it(`the inactive ${tone} tab label is AA on its tab`, () => {
      // The tab is the tone mixed 62% into the ground (SpaceTabs INACTIVE).
      const tab = over({ rgb: token(`sheet-${tone}`).rgb, alpha: 0.62 }, token("ground").rgb);
      const ratio = contrast(token("sheet-ink-secondary"), tab);
      expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });
  }

  it("keeps dark teal readable on every peach fill: buttons, counts and avatars", () => {
    const dark = token("dark");
    const fills = ["primary", ...AVATAR_FILLS.map((fill) => fill.replace("bg-", ""))];
    for (const fill of fills) {
      const ratio = contrast(dark, token(fill).rgb);
      expect(ratio, `dark on ${fill}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("draws Tembo's T in peach that reads on deep teal", () => {
    expect(contrast(token("primary"), token("dark").rgb)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps the sheet ink ramp ordered, so muted still means something", () => {
    expect(token("ink-primary").alpha).toBeGreaterThan(token("sheet-ink-secondary").alpha);
    expect(token("sheet-ink-secondary").alpha).toBeGreaterThan(token("sheet-ink-muted").alpha);
  });

  it("orders the tones darkest to lightest, with profile the binding case", () => {
    const light = SPACE_ORDER.map((tone) => [tone, luminance(token(`sheet-${tone}`).rgb)] as const);
    const lightest = light.toSorted((a, b) => b[1] - a[1])[0][0];
    const darkest = light.toSorted((a, b) => a[1] - b[1])[0][0];
    expect(lightest).toBe("profile");
    expect(darkest).toBe("admin");
  });

  it("keeps the avatar fills distinct from one another", () => {
    // Two near-identical fills would make two people look like one.
    const fills = AVATAR_FILLS.map((fill) => token(fill.replace("bg-", "")).rgb);
    for (let i = 0; i < fills.length; i += 1) {
      for (let j = i + 1; j < fills.length; j += 1) {
        const distance = Math.hypot(...fills[i].map((c, k) => c - fills[j][k]));
        expect(distance, `${AVATAR_FILLS[i]} vs ${AVATAR_FILLS[j]}`).toBeGreaterThan(40);
      }
    }
  });
});
