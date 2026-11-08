import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colourToken } from "@/lib/design/tokens";
import { CHOICE_BOX } from "./recipes";

const CSS = readFileSync(join(__dirname, "choice.css"), "utf8");
const FIELD = readFileSync(join(__dirname, "Field.tsx"), "utf8");
const rem = (value: string) => Number.parseFloat(value) * 16;

describe("the drawn checkbox and radio", () => {
  it("is what CHOICE_BOX names, with the kit's focus ring, and the fields bring its stylesheet", () => {
    expect(CHOICE_BOX).toMatch(/^kit-choice /);
    expect(CHOICE_BOX).toContain("focus-visible:outline-peach-ink");
    expect(FIELD).toContain('import "./choice.css";');
  });

  it("keeps the native input, so the keyboard, the form and the screen reader all still work", () => {
    expect(CSS).toMatch(/\.kit-choice\s*{[^}]*appearance:\s*none/);
    expect(CSS).toMatch(/@media \(forced-colors: active\)\s*{\s*\.kit-choice\s*{[^}]*appearance:\s*auto/);
  });

  it("is a 20px box everywhere and a 44px target on a touch screen, without moving its row", () => {
    const box = rem(/width:\s*calc\(([\d.]+)rem \+ 2 \* var\(--choice-target\)\)/.exec(CSS)![1]);
    const coarse = /@media \(pointer: coarse\)\s*{\s*\.kit-choice\s*{\s*--choice-target:\s*([\d.]+)rem/.exec(CSS);
    expect(box).toBe(20);
    expect(coarse, "a coarse-pointer target").not.toBeNull();
    expect(box + 2 * rem(coarse![1])).toBe(44);
    // The border that makes the target is handed back by a margin as wide.
    expect(CSS).toMatch(/margin:\s*calc\(0\.125rem - var\(--choice-target\)\) calc\(0px - var\(--choice-target\)\) calc\(0px - var\(--choice-target\)\)/);
    expect(CSS).toMatch(/border:\s*var\(--choice-target\) solid transparent/);
  });

  it("draws the tick in the dark token, which an SVG in a stylesheet cannot read by name", () => {
    const tick = /stroke='%23([0-9A-Fa-f]{6})'/.exec(CSS)?.[1];
    expect(`#${tick}`.toLowerCase()).toBe(colourToken("dark").toLowerCase());
  });

  it("draws its edge as an inset line and never with a mask, which would clip the focus ring", () => {
    expect(CSS).toContain("box-shadow: inset 0 0 0 1px var(--choice-edge)");
    expect(CSS).not.toMatch(/\bmask(-image)?:/);
  });
});
