import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHIP_TONES } from "@/components/platform/ui/tones";

/**
 * The welcome cards' words over the welcome sheet, chosen or not, recomputed
 * from the stylesheets so a token or tint change cannot drift past AA. The
 * chosen card is the brightest surface the chips land on.
 */
const GLOBAL_CSS = readFileSync(resolve(__dirname, "../../../styles/global.css"), "utf8");
const ONBOARDING_CSS = readFileSync(resolve(__dirname, "onboarding.css"), "utf8");
type Rgb = [number, number, number];

const token = (name: string) => /#([0-9a-f]{6})/i.exec(new RegExp(`--color-${name}:\\s*([^;]+);`).exec(GLOBAL_CSS)![1])![0];
const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const over = (top: Rgb, alpha: number, base: Rgb) => top.map((c, i) => alpha * c + (1 - alpha) * base[i]!) as Rgb;
const luminance = ([r, g, b]: Rgb) => {
  const ch = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** The ink alpha a rule block paints a card with: `background-color: rgb(255 248 242 / a)`. */
function cardAlpha(selector: string): number {
  const block = ONBOARDING_CSS.slice(ONBOARDING_CSS.indexOf(`${selector} {`));
  return Number(/background-color: rgb\(255 248 242 \/ ([\d.]+)\)/.exec(block.slice(0, block.indexOf("}")))![1]);
}
/** A chip tone's tint strength and ink, read from the class names Chip uses. */
function chip(tone: "peach" | "ring"): { tint: Rgb; alpha: number; ink: Rgb } {
  const [bg, text] = CHIP_TONES[tone].split(" ");
  const [, name, alpha] = /^bg-([a-z-]+)\/(\d+)$/.exec(bg!)!;
  const ink = text!.replace("text-", "");
  return { tint: hex(token(name === "primary" ? "primary" : name!)), alpha: Number(alpha) / 100, ink: hex(token(ink)) };
}

const SHEET = hex(token("sheet-welcome"));
const INK = hex(token("ink-primary"));
const SURFACES = {
  card: over(INK, cardAlpha(".welcome-choice"), SHEET),
  chosen: over(INK, cardAlpha(".welcome-choice:has(:checked)"), SHEET),
};

describe("the welcome cards' contrast", () => {
  const chips = Object.entries(SURFACES).flatMap(([name, surface]) => (["peach", "ring"] as const).map((tone) => [tone, name, surface] as const));
  it.each(chips)("keeps the %s chip at AA on a %s", (tone, _, surface) => {
    const { tint, alpha, ink } = chip(tone);
    expect(contrast(ink, over(tint, alpha, surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(SURFACES))("keeps a card's body text at AA on a %s", (_, surface) => {
    expect(contrast(over(INK, 0.72, surface), surface)).toBeGreaterThanOrEqual(4.5);
  });
});
