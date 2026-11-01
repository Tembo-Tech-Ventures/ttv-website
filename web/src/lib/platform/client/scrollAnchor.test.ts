// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  appendedSince, captureScroll, distanceFromBottom, findItem, isAtBottom, isMeasurable, restoreScroll, scrollToBottom,
  scrollToItem,
} from "./scrollAnchor";
import { installScrollGeometry } from "./scrollGeometry.test-support";

let uninstall: () => void;
beforeAll(() => { uninstall = installScrollGeometry(); });
afterAll(() => uninstall());

let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("section");
  container.dataset.viewport = "300";
  document.body.appendChild(container);
});

/** Render items with these ids, each 100px tall unless given. */
function render(ids: readonly (string | [string, number])[]) {
  container.replaceChildren(...ids.map(entry => {
    const [id, size] = typeof entry === "string" ? [entry, 100] : entry;
    const item = document.createElement("li");
    item.setAttribute("data-message-row", id);
    item.dataset.height = String(size);
    return item;
  }));
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `m${from + i}`);

describe("scroll anchoring core", () => {
  it("measures the distance from the end and the bottom threshold", () => {
    render(range(1, 10));
    expect(distanceFromBottom(container)).toBe(700);
    container.scrollTop = 650;
    expect(isAtBottom(container)).toBe(true);
    expect(isAtBottom(container, 10)).toBe(false);
    scrollToBottom(container);
    expect(container.scrollTop).toBe(700);
    expect(distanceFromBottom(container)).toBe(0);
  });

  it("captures the first visible items and their offsets", () => {
    render(range(1, 10));
    container.scrollTop = 250;
    expect(captureScroll(container)).toEqual({
      atBottom: false, scrollTop: 250,
      anchors: [{ id: "m3", offset: -50 }, { id: "m4", offset: 50 }, { id: "m5", offset: 150 }],
    });
    const unnamed = document.createElement("li");
    unnamed.setAttribute("data-message-row", "");
    unnamed.dataset.height = "100";
    container.insertBefore(unnamed, container.firstChild);
    container.scrollTop = 0;
    expect(captureScroll(container).anchors[0]).toEqual({ id: "m1", offset: 100 });
    expect(captureScroll(container, { attribute: "data-other" }).anchors).toEqual([]);
  });

  it("measures inside the container's border and ignores a hairline sliver", () => {
    render(range(1, 10));
    Object.defineProperty(container, "clientTop", { configurable: true, value: 1 });
    // m1 ends under the 1px border, or shows one hairline: m2 is where the reader is.
    container.scrollTop = 99;
    expect(captureScroll(container).anchors[0]).toEqual({ id: "m2", offset: 0 });
    container.scrollTop = 98;
    expect(captureScroll(container).anchors[0]).toEqual({ id: "m2", offset: 1 });
    // Two pixels of m1 are a real part of the view.
    container.scrollTop = 97;
    expect(captureScroll(container).anchors[0]).toEqual({ id: "m1", offset: -98 });
  });

  it("keeps the reader's place when older items are prepended", () => {
    render(range(11, 20));
    container.scrollTop = 120;
    const before = captureScroll(container);
    render([...range(1, 10), ...range(11, 20)]);
    expect(restoreScroll(container, before)).toBe(true);
    expect(container.scrollTop).toBe(1_120);
    expect(captureScroll(container).anchors[0]).toEqual(before.anchors[0]);
  });

  it("keeps the place when items above are evicted, resized or the first anchor is removed", () => {
    render(range(1, 20));
    container.scrollTop = 1_030;
    const before = captureScroll(container);
    expect(before.anchors[0].id).toBe("m11");
    render(range(6, 20));
    restoreScroll(container, before);
    // As the hook does, the position is captured again after each restore.
    const after = captureScroll(container);
    expect(after.anchors[0]).toEqual({ id: "m11", offset: -30 });
    render([["m6", 400], ...range(7, 10), ...range(12, 20)]);
    restoreScroll(container, after);
    // The next remembered item, m12, is back at its offset; m10 now peeks in above it.
    expect(captureScroll(container).anchors.slice(0, 2)).toEqual([{ id: "m10", offset: -30 }, { id: "m12", offset: 70 }]);
  });

  it("stays at the newest end when the reader was there, and leaves the position alone without anchors", () => {
    render(range(1, 5));
    scrollToBottom(container);
    const atEnd = captureScroll(container);
    expect(atEnd.atBottom).toBe(true);
    render(range(1, 8));
    restoreScroll(container, atEnd);
    expect(container.scrollTop).toBe(500);
    container.scrollTop = 100;
    expect(restoreScroll(container, { atBottom: false, scrollTop: 100, anchors: [{ id: "gone", offset: 0 }] })).toBe(false);
    expect(container.scrollTop).toBe(100);
    expect(restoreScroll(container, { atBottom: false, scrollTop: 100, anchors: [{ id: "m2", offset: 0 }] })).toBe(true);
    expect(container.scrollTop).toBe(100);
  });

  it("keeps a scroll made before its event arrived, when older items land in the same frame", () => {
    render(range(11, 20));
    container.scrollTop = 400;
    const before = captureScroll(container);
    // The reader scrolls up 120px; the prepend renders before that scroll event is seen.
    container.scrollTop = 280;
    render([...range(1, 10), ...range(11, 20)]);
    restoreScroll(container, before);
    expect(container.scrollTop).toBe(1_280);
  });

  it("does not take clamping by shrinking content for a reader's scroll", () => {
    render(range(1, 20));
    container.scrollTop = 1_050;
    const before = captureScroll(container);
    expect(before.anchors[0]).toEqual({ id: "m11", offset: -50 });
    // Older pages are evicted; the browser clamps scrollTop to the new end (here: via the setter).
    render(range(11, 20));
    container.scrollTop = 1_050;
    expect(container.scrollTop).toBe(700);
    restoreScroll(container, before);
    expect(captureScroll(container).anchors[0]).toEqual({ id: "m11", offset: -50 });
  });

  it("treats a container without a box as not measurable", () => {
    render(range(1, 3));
    expect(isMeasurable(container)).toBe(true);
    container.dataset.viewport = "0";
    expect(isMeasurable(container)).toBe(false);
  });

  it("scrolls the container alone to an item's top or middle", () => {
    render(range(1, 10));
    expect(scrollToItem(container, "m5")).toBe(true);
    expect(container.scrollTop).toBe(400);
    expect(scrollToItem(container, "m5", { block: "center" })).toBe(true);
    expect(container.scrollTop).toBe(300);
    expect(scrollToItem(container, "missing")).toBe(false);
    expect(findItem(container, "m3")?.getAttribute("data-message-row")).toBe("m3");
    expect(findItem(container, 'm3"] , [x')).toBeNull();
  });

  it("finds the items appended after the previous last one", () => {
    const item = (id: string) => ({ id });
    expect(appendedSince([], [item("a")])).toEqual([]);
    expect(appendedSince([item("a"), item("b")], [item("a"), item("b"), item("c")])).toEqual([item("c")]);
    expect(appendedSince([item("b")], [item("a"), item("b")])).toEqual([]);
    expect(appendedSince([item("x")], [item("a")])).toEqual([]);
  });
});
