import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The channel view's own stylesheets draw only with the theme's tokens
 * (docs/design-system/foundations.md): a colour is a `var(--color-…)`, mixed
 * with `color-mix()` where it needs to be fainter, never a raw value the
 * contrast proofs do not cover. And inside a sheet nothing casts a shadow.
 */

const SHEETS = ["channels.css", "masked.css"] as const;
const css = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe.each(SHEETS)("%s", (name) => {
  const source = css(name);

  it("has no raw colour: no rgb(), rgba(), hsl() or hex", () => {
    expect(source.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([]);
    expect(source.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });

  it("names no colour by keyword either, black and white included", () => {
    expect(source.match(/:\s*[^;]*\b(?:black|white)\b/g) ?? []).toEqual([]);
  });

  it("casts no shadow inside the sheet", () => {
    const shadows = [...source.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((match) => match[1].trim());
    expect(shadows.filter((value) => value !== "none")).toEqual([]);
  });
});

describe("channels.css", () => {
  const source = css("channels.css");

  it("leaves the kit's parts to the kit: no rules for controls it now draws", () => {
    for (const gone of [
      ".channel-composer__send", ".channel-attached__remove", ".channel-spinner", ".channel-choice", ".channel-input", ".channel-confirm",
      ".channel-posting-note", ".channel-tembo__choice", ".channel-clips__option", ".channel-clips__close", ".channel-ai-badge", ".channel-menu",
      ".channel-empty", ".channel-panel__error", "[data-channel-chip]", "[data-conversation-privacy]",
    ]) {
      expect(source, `${gone}`).not.toContain(gone);
    }
  });

  it("never hides the message actions until hover", () => {
    expect(source).not.toMatch(/\.channel-message__more[^{]*\{[^}]*opacity\s*:\s*0/);
  });
});
