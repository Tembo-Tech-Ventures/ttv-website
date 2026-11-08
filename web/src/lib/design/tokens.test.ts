import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, formatRatio, parseColour } from "./contrast";
import { COLOUR_GROUPS, SHEET_TOKENS, colourToken, readingSurfaces, trackingToken, worstContrast } from "./tokens";

const CSS = readFileSync(resolve(__dirname, "../../styles/global.css"), "utf8");

describe("the style guide's colour tokens", () => {
  it("are read from global.css, value for value", () => {
    for (const { colours } of COLOUR_GROUPS) {
      for (const { token } of colours) {
        expect(CSS).toContain(`--color-${token}: ${colourToken(token)};`);
      }
    }
  });

  it("name every sheet tone the spaces use", () => {
    const sheets = COLOUR_GROUPS.find((group) => group.id === "sheets")!.colours.map((colour) => colour.token);
    for (const space of SHEET_TOKENS) expect(sheets).toContain(`sheet-${space}`);
  });

  it("list each token once", () => {
    const tokens = COLOUR_GROUPS.flatMap((group) => group.colours.map((colour) => colour.token));
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("fail loudly for a token the stylesheet does not define", () => {
    expect(() => colourToken("nonexistent")).toThrow(/not defined/);
    expect(trackingToken("display")).toBe("-0.02em");
  });
});

describe("printed contrast", () => {
  it("covers every sheet and a card on each", () => {
    expect(readingSurfaces()).toHaveLength(SHEET_TOKENS.length * 2);
  });

  it("is the worst case, and every ink the guide prints meets AA", () => {
    for (const ink of ["ink-primary", "ink-secondary", "ink-muted", "peach-ink", "ring", "danger-ink", "success-ink", "warning-ink"]) {
      const printed = Number.parseFloat(worstContrast(ink));
      expect(printed, `${ink}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("rounds down, so it never claims more than the colours have", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
    expect(formatRatio(21)).toBe("21.00:1");
  });

  it("agrees with the WCAG formula's fixed points", () => {
    expect(contrast(parseColour("#FFFFFF").rgb, parseColour("#000000").rgb)).toBeCloseTo(21, 5);
    expect(parseColour("rgba(255, 248, 242, 0.72)")).toEqual({ rgb: [255, 248, 242], alpha: 0.72 });
  });
});
