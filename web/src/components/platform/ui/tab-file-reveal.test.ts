// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { needsTabReveal, revealCurrentTabs } from "./tab-file-reveal";

function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
}

function file(tabLeft: number, nested = false) {
  document.body.innerHTML = `
    <div class="space-file"><div class="space-file__row"><nav class="space-file__nav">
      <a href="/a">A</a><a href="/b" aria-current="page">B</a>
    </nav></div>
    ${nested ? '<div><div class="space-file"><div class="space-file__row"><nav class="space-file__nav" id="inner"><a aria-current="page" href="/x">X</a></nav></div></div></div>' : ""}
    </div>`;
  const strip = document.querySelector<HTMLElement>(".space-file__nav")!;
  strip.getBoundingClientRect = () => rect(0, 300);
  strip.querySelector<HTMLElement>('[aria-current="page"]')!.getBoundingClientRect = () => rect(tabLeft, 100);
  return strip;
}

describe("revealCurrentTabs", () => {
  it("centres a current tab that sits past the strip's edge", () => {
    const strip = file(450);
    revealCurrentTabs();
    // 450 - 0 - (300 - 100) / 2
    expect(strip.scrollLeft).toBe(350);
  });

  it("leaves a strip alone when its current tab is already in view", () => {
    const strip = file(120);
    revealCurrentTabs();
    expect(strip.scrollLeft).toBe(0);
  });

  it("finds every file's own strip, nested files included, and skips strips with no current tab", () => {
    file(450, true);
    const inner = document.getElementById("inner")!;
    inner.getBoundingClientRect = () => rect(0, 100);
    inner.querySelector<HTMLElement>("a")!.getBoundingClientRect = () => rect(20, 40);
    expect(() => revealCurrentTabs()).not.toThrow();
    expect(inner.scrollLeft).toBe(0);
  });
});

describe("needsTabReveal", () => {
  it("is needed only where the browser cannot open a strip on its current tab itself", () => {
    expect(needsTabReveal({ supports: () => true })).toBe(false);
    expect(needsTabReveal({ supports: () => false })).toBe(true);
    expect(needsTabReveal({})).toBe(true);
  });
});
