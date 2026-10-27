import type { Page } from "@playwright/test";

/**
 * "Can every word on this page actually be read?" — checked in a real browser.
 *
 * The values on an earlier homepage were set in outlined display type that its
 * own box cropped, and nothing failed. This tracker walks a page the way a
 * visitor scrolls it and records, for every text node, whether each of its
 * lines was at some moment fully inside the viewport, not cropped by any
 * ancestor that clips overflow, not covered by another element and not faded
 * out. Text that is never readable at any scroll position is an issue.
 * Animated content passes once it has settled into view, and horizontally
 * scrolling tracks pass once each item has passed through.
 *
 * Text under aria-hidden is decorative and reported separately: it may be
 * cropped deliberately (the footer wordmark is), but should not carry meaning.
 *
 * Only erasable TypeScript is used so Node can run this file directly from the
 * homepage lab scripts.
 */

export interface TextIssue {
  text: string;
  path: string;
  reason: string;
  decorative: boolean;
}

export interface TextReport {
  checked: number;
  issues: TextIssue[];
  maxHorizontalOverflow: number;
}

/** Installs the tracker. Call after navigation and before walking the page. */
export async function installTextTracker(page: Page, rootSelector = "body"): Promise<void> {
  await page.evaluate((selector) => {
    interface Entry { node: Text; seen: Set<number>; lines: number; reason: string; decorative: boolean }
    const root = document.querySelector(selector) ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || node.textContent.trim().length < 2) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest("script, style, noscript, template, astro-dev-toolbar, [hidden], [inert]")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const entries: Entry[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = (node as Text).parentElement!;
      entries.push({
        node: node as Text,
        seen: new Set(),
        lines: -1,
        reason: "never scrolled into view",
        decorative: Boolean(parent.closest('[aria-hidden="true"]')),
      });
    }
    (window as unknown as { __ttvText: unknown }).__ttvText = { entries, overflow: 0 };
  }, rootSelector);
}

/** Records which lines of text are readable at the current scroll position. */
export async function sampleText(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface Entry { node: Text; seen: Set<number>; lines: number; reason: string; decorative: boolean }
    interface Clipper { rect: DOMRect; label: string }
    interface Ancestry { opacity: number; invisible: boolean; pointerless: boolean; clippers: Clipper[] }
    const state = (window as unknown as { __ttvText?: { entries: Entry[]; overflow: number } }).__ttvText;
    if (!state) throw new Error("installTextTracker must run first");
    const tolerance = 1.5;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    state.overflow = Math.max(state.overflow, document.documentElement.scrollWidth - vw);

    function describe(el: Element) {
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : "";
      return `<${el.tagName.toLowerCase()}${cls}>`;
    }

    function overflowClip(el: Element, style: CSSStyleDeclaration): Clipper | null {
      const clipsX = style.overflowX !== "visible";
      const clipsY = style.overflowY !== "visible";
      if ((!clipsX && !clipsY) || el === document.body) return null;
      const box = el.getBoundingClientRect();
      const rect = new DOMRect(
        clipsX ? box.left + el.clientLeft : -Infinity,
        clipsY ? box.top + el.clientTop : -Infinity,
        clipsX ? el.clientWidth : Infinity,
        clipsY ? el.clientHeight : Infinity,
      );
      return { rect, label: `overflow:${style.overflowX}/${style.overflowY} on ${describe(el)}` };
    }

    /** Opacity, visibility, hit-testing and every box that can crop this element. */
    function ancestry(element: Element): Ancestry {
      const result: Ancestry = { opacity: 1, invisible: false, pointerless: false, clippers: [] };
      for (let el: Element | null = element; el && el !== document.documentElement; el = el.parentElement) {
        const style = getComputedStyle(el);
        result.opacity *= Number.parseFloat(style.opacity);
        result.invisible ||= style.visibility === "hidden" || style.visibility === "collapse";
        result.pointerless ||= style.pointerEvents === "none";
        if (style.clipPath !== "none" && style.clipPath !== "") {
          result.clippers.push({ rect: el.getBoundingClientRect(), label: `clip-path on ${describe(el)}` });
        }
        const clip = overflowClip(el, style);
        if (clip) result.clippers.push(clip);
      }
      return result;
    }

    function outside(rect: DOMRect, box: DOMRect) {
      return rect.left < box.left - tolerance || rect.right > box.right + tolerance || rect.top < box.top - tolerance || rect.bottom > box.bottom + tolerance;
    }

    /** Why one line of text is not readable right now, or null if it is. */
    function lineProblem(rect: DOMRect, element: Element, context: Ancestry): string | null {
      if (outside(rect, new DOMRect(0, 0, vw, vh))) {
        const intersects = rect.right > 0 && rect.left < vw && rect.bottom > 0 && rect.top < vh;
        if (!intersects) return "never scrolled into view";
        return rect.left < 0 || rect.right > vw ? "extends past the side of the viewport" : "partly off screen";
      }
      const clipper = context.clippers.find((candidate) => outside(rect, candidate.rect));
      if (clipper) return `cropped by ${clipper.label}`;
      if (context.pointerless) return null;
      const x = Math.min(Math.max(rect.left + rect.width / 2, 0), vw - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 0), vh - 1);
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== element && !hit.contains(element) && !element.contains(hit)) return `covered by ${describe(hit)}`;
      return null;
    }

    function sample(entry: Entry) {
      if (entry.lines >= 0 && entry.seen.size >= entry.lines) return;
      if (!entry.node.isConnected) {
        entry.reason = "removed from the page before it was readable";
        return;
      }
      const element = entry.node.parentElement!;
      // display:none, a closed <details> and content-visibility:hidden are
      // deliberate (responsive alternatives, disclosures), not defects.
      if (!element.checkVisibility()) {
        entry.reason = "hidden by design";
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(entry.node);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5);
      if (rects.length === 0) {
        entry.reason = "rendered with no size";
        return;
      }
      entry.lines = rects.length;
      const context = ancestry(element);
      if (context.invisible) {
        entry.reason = "visibility hidden";
        return;
      }
      if (context.opacity < 0.6) {
        entry.reason = `faded out (opacity ${context.opacity.toFixed(2)})`;
        return;
      }
      rects.forEach((rect, index) => {
        if (entry.seen.has(index)) return;
        const problem = lineProblem(rect, element, context);
        if (problem === null) entry.seen.add(index);
        else if (problem !== "never scrolled into view" || entry.reason === "never scrolled into view") entry.reason = problem;
      });
    }

    for (const entry of state.entries) sample(entry);
  });
}

/**
 * Swipes every horizontally scrollable track currently on screen from start to
 * end, sampling as it goes, so items that only arrive by swiping are counted.
 */
export async function sweepHorizontalScrollers(page: Page, settleMs = 250): Promise<void> {
  const count = await page.evaluate(() => {
    let index = 0;
    for (const el of document.querySelectorAll<HTMLElement>("main *")) {
      el.removeAttribute("data-ttv-sweep");
      const style = getComputedStyle(el);
      if (!/(auto|scroll)/.test(style.overflowX) || el.scrollWidth <= el.clientWidth + 2) continue;
      const box = el.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= window.innerHeight) continue;
      el.setAttribute("data-ttv-sweep", String(index));
      index += 1;
    }
    return index;
  });
  for (let index = 0; index < count; index += 1) {
    for (let guard = 0; guard < 40; guard += 1) {
      const moved = await page.evaluate((i) => {
        const el = document.querySelector<HTMLElement>(`[data-ttv-sweep="${i}"]`);
        if (!el) return false;
        const before = el.scrollLeft;
        el.scrollTo({ left: before + el.clientWidth * 0.6, behavior: "instant" });
        return el.scrollLeft > before + 1;
      }, index);
      await page.waitForTimeout(settleMs);
      await sampleText(page);
      if (!moved) break;
    }
    await page.evaluate((i) => {
      document.querySelector<HTMLElement>(`[data-ttv-sweep="${i}"]`)?.scrollTo({ left: 0, behavior: "instant" });
    }, index);
  }
}

/** Scrolls top to bottom like a visitor, sampling after each step settles. */
export async function walkAndSample(
  page: Page,
  { stepRatio = 0.4, settleMs = 450, onStep }: { stepRatio?: number; settleMs?: number; onStep?: (index: number) => Promise<void> } = {},
): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(settleMs);
  await sampleText(page);
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  let still = 0;
  for (let index = 0; index < 400 && still < 3; index += 1) {
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, Math.round(viewport.height * stepRatio));
    await page.waitForTimeout(settleMs);
    await sampleText(page);
    await sweepHorizontalScrollers(page);
    if (onStep) await onStep(index);
    const after = await page.evaluate(() => window.scrollY);
    still = Math.abs(after - before) < 2 ? still + 1 : 0;
  }
  await page.waitForTimeout(settleMs);
  await sampleText(page);
}

export async function textReport(page: Page): Promise<TextReport> {
  return page.evaluate(() => {
    interface Entry { node: Text; seen: Set<number>; lines: number; reason: string; decorative: boolean }
    const state = (window as unknown as { __ttvText: { entries: Entry[]; overflow: number } }).__ttvText;
    function path(element: Element | null) {
      const parts: string[] = [];
      for (let el = element; el && el !== document.body && parts.length < 4; el = el.parentElement) {
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
        parts.unshift(`${el.tagName.toLowerCase()}${id}${cls}`);
      }
      return parts.join(" > ");
    }
    const issues = state.entries
      .filter((entry) => entry.lines < 0 || entry.seen.size < entry.lines)
      .filter((entry) => entry.reason !== "hidden by design")
      .map((entry) => ({
        text: (entry.node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
        path: path(entry.node.parentElement),
        reason: entry.reason,
        decorative: entry.decorative,
      }));
    return { checked: state.entries.length, issues, maxHorizontalOverflow: Math.max(0, state.overflow) };
  });
}
