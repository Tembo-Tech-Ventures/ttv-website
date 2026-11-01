// @vitest-environment happy-dom
import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureScroll } from "../scrollAnchor";
import { installScrollGeometry, userScroll } from "../scrollGeometry.test-support";
import { useScrollAnchoring, type ScrollAnchoring, type ScrollAnchoringOptions } from "./scroll";

interface Item { id: string; height?: number; mine?: boolean }
const range = (from: number, to: number, extra: Partial<Item> = {}): Item[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: `m${from + i}`, ...extra }));

let anchoring: ScrollAnchoring;
type ListProps = Omit<ScrollAnchoringOptions<Item>, "items"> & {
  items: Item[]; viewport?: number; surface?: string; seen?: (atBottom: boolean) => void;
};
function List({ items, viewport = 300, surface = "a", seen, ...options }: ListProps) {
  const ref = useRef<HTMLElement>(null);
  anchoring = useScrollAnchoring(ref, { items, ...options });
  // A consumer that marks read while atBottom, as the README describes.
  const { atBottom } = anchoring;
  useEffect(() => { seen?.(atBottom); }, [atBottom, seen]);
  return (
    <section key={surface} ref={ref} data-viewport={viewport} data-surface={surface} data-at-bottom={anchoring.atBottom}>
      <ol>{items.map(item => <li key={item.id} data-message-row={item.id} data-height={item.height ?? 100} />)}</ol>
    </section>
  );
}

/** Captures ResizeObserver instances so a test can report a size change. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(readonly callback: () => void) { FakeResizeObserver.instances.push(this); }
  observe(element: Element) { this.observed.add(element); }
  disconnect() { this.observed.clear(); }
  unobserve(element: Element) { this.observed.delete(element); }
}

let uninstall: () => void;
beforeAll(() => { uninstall = installScrollGeometry(); });
afterAll(() => uninstall());

describe("useScrollAnchoring", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    FakeResizeObserver.instances = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const scroller = () => container.querySelector<HTMLElement>("[data-viewport]")!;
  const render = (props: Parameters<typeof List>[0]) => act(async () => root.render(<List {...props} />));
  const firstVisible = () => captureScroll(scroller()).anchors[0];

  it("opens at the newest end and follows new items while the reader is there", async () => {
    const onAnchor = vi.fn();
    await render({ items: [], onAnchor });
    expect(onAnchor).not.toHaveBeenCalled();
    await render({ items: range(1, 10), onAnchor });
    expect(scroller().scrollTop).toBe(700);
    expect(scroller().style.overflowAnchor).toBe("none");
    expect(anchoring.atBottom).toBe(true);
    expect(onAnchor).toHaveBeenCalledWith(null);
    await render({ items: range(1, 12), onAnchor });
    expect(scroller().scrollTop).toBe(900);
    expect(onAnchor).toHaveBeenCalledTimes(1);
  });

  it("keeps the place when older items are prepended, and never moves a reader who scrolled up", async () => {
    const onAnchor = vi.fn();
    await render({ items: range(11, 20), onAnchor });
    await act(async () => userScroll(scroller(), 150));
    expect(anchoring.atBottom).toBe(false);
    expect(onAnchor).toHaveBeenLastCalledWith("m12");
    const before = firstVisible();
    await render({ items: range(1, 20), onAnchor });
    expect(firstVisible()).toEqual(before);
    expect(scroller().scrollTop).toBe(1_150);
    // New items at the end don't pull the reader down.
    await render({ items: range(1, 25), onAnchor });
    expect(firstVisible()).toEqual(before);
    // Older pages evicted from memory above the reader don't move them either.
    await render({ items: range(6, 25), onAnchor });
    expect(firstVisible()).toEqual(before);
    expect(container.querySelector("[data-at-bottom]")?.getAttribute("data-at-bottom")).toBe("false");
  });

  it("opens at a linked item, and falls back to the end when it is not rendered", async () => {
    const onAnchor = vi.fn();
    await render({ items: range(1, 10), initialItemId: "m4", onAnchor });
    expect(scroller().scrollTop).toBe(300);
    expect(onAnchor).toHaveBeenLastCalledWith("m4");
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ items: range(1, 10), initialItemId: "missing" });
    expect(scroller().scrollTop).toBe(700);
  });

  it("opened at an item just above the end, holds there until the reader scrolls", async () => {
    const onAnchor = vi.fn();
    // m8's top is 50px from the end: inside the 100px threshold, but not the end.
    const items = [...range(1, 9), { id: "m10", height: 150 }];
    await render({ items, initialItemId: "m8", onAnchor });
    expect(scroller().scrollTop).toBe(700);
    expect(anchoring.atBottom).toBe(false);
    expect(onAnchor).toHaveBeenLastCalledWith("m8");
    // Someone posts: the opening item stays in view, nothing follows to the end.
    await render({ items: [...items, { id: "m11" }], initialItemId: "m8", onAnchor });
    expect(firstVisible()).toEqual({ id: "m8", offset: 0 });
    // A scroll the hook made itself (its event arrives late) changes nothing.
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    expect(anchoring.atBottom).toBe(false);
    // The reader's own scroll ends the hold: near the end is the bottom again.
    await act(async () => userScroll(scroller(), 790));
    expect(anchoring.atBottom).toBe(true);
    expect(onAnchor).toHaveBeenLastCalledWith(null);
  });

  it("scrollToBottom ends the hold at the opening item", async () => {
    const items = [...range(1, 9), { id: "m10", height: 150 }];
    await render({ items, initialItemId: "m8" });
    await act(async () => anchoring.scrollToBottom());
    expect(anchoring.atBottom).toBe(true);
    await render({ items: [...items, { id: "m11" }], initialItemId: "m8" });
    expect(scroller().scrollTop).toBe(850);
  });

  it("follows the reader's own new message even when they had scrolled up", async () => {
    const shouldFollow = (appended: readonly Item[]) => appended.some(item => item.mine);
    await render({ items: range(1, 10), shouldFollow });
    await act(async () => userScroll(scroller(), 0));
    await render({ items: range(1, 11), shouldFollow });
    expect(scroller().scrollTop).toBe(0);
    await render({ items: [...range(1, 11), { id: "own", mine: true }], shouldFollow });
    expect(scroller().scrollTop).toBe(900);
    expect(anchoring.atBottom).toBe(true);
  });

  it("re-applies the position when content changes size", async () => {
    await render({ items: range(1, 10) });
    const [observer] = FakeResizeObserver.instances;
    expect(observer.observed.has(scroller())).toBe(true);
    expect(observer.observed.size).toBe(2);
    // An embed loads in the newest message while the reader is at the end.
    container.querySelector<HTMLElement>("[data-message-row=m10]")!.dataset.height = "250";
    await act(async () => observer.callback());
    expect(scroller().scrollTop).toBe(850);
    // An image above the reader grows: the reader's message stays put.
    await act(async () => userScroll(scroller(), 400));
    const before = firstVisible();
    container.querySelector<HTMLElement>("[data-message-row=m2]")!.dataset.height = "300";
    await act(async () => observer.callback());
    expect(firstVisible()).toEqual(before);
  });

  it("jumps to the newest end, keeps following the next page, and scrolls to an item", async () => {
    await render({ items: range(1, 10) });
    await act(async () => userScroll(scroller(), 0));
    expect(anchoring.scrollToItem("m3")).toBe(true);
    expect(scroller().scrollTop).toBe(200);
    expect(anchoring.scrollToItem("m6", "center")).toBe(true);
    expect(scroller().scrollTop).toBe(400);
    expect(anchoring.scrollToItem("missing")).toBe(false);
    await act(async () => anchoring.scrollToBottom());
    expect(anchoring.atBottom).toBe(true);
    // Jump to latest replaces the window with a fresh page.
    await render({ items: range(40, 60) });
    expect(scroller().scrollTop).toBe(1_800);
  });

  it("a hidden list is never measured: it keeps the place, atBottom and the anchor until it shows again", async () => {
    const onAnchor = vi.fn();
    await render({ items: range(1, 20), onAnchor });
    await act(async () => userScroll(scroller(), 300));
    expect(onAnchor).toHaveBeenLastCalledWith("m4");
    const calls = onAnchor.mock.calls.length;
    // The thread rail takes the sheet on a phone: the list loses its box, and someone posts meanwhile.
    await render({ items: range(1, 21), onAnchor, viewport: 0 });
    const [observer] = FakeResizeObserver.instances;
    await act(async () => observer.callback());
    expect(anchoring.atBottom).toBe(false);
    expect(onAnchor).toHaveBeenCalledTimes(calls);
    expect(anchoring.scrollToItem("m2")).toBe(false);
    await act(async () => anchoring.scrollToBottom());
    expect(anchoring.atBottom).toBe(false);
    // Shown again: the reader is where they were, not at the bottom.
    await render({ items: range(1, 21), onAnchor, viewport: 300 });
    await act(async () => observer.callback());
    expect(firstVisible()).toEqual({ id: "m4", offset: 0 });
    expect(anchoring.atBottom).toBe(false);
    expect(onAnchor).toHaveBeenCalledTimes(calls);
  });

  it("a list mounted hidden opens at its linked item once it has a box", async () => {
    const onAnchor = vi.fn();
    await render({ items: range(1, 10), initialItemId: "m4", onAnchor, viewport: 0 });
    expect(onAnchor).not.toHaveBeenCalled();
    expect(scroller().scrollTop).toBe(0);
    await render({ items: range(1, 10), initialItemId: "m4", onAnchor, viewport: 300 });
    expect(scroller().scrollTop).toBe(300);
    expect(onAnchor).toHaveBeenLastCalledWith("m4");
  });

  it("keeps a scroll whose event hasn't arrived when older items render in the same frame", async () => {
    await render({ items: range(11, 20) });
    await act(async () => userScroll(scroller(), 400));
    scroller().scrollTop = 280;
    await render({ items: range(1, 20) });
    expect(scroller().scrollTop).toBe(1_280);
  });

  it("starts over on a re-mounted scroll element, and listens to the new one", async () => {
    await render({ items: range(1, 10), surface: "a" });
    await act(async () => userScroll(scroller(), 0));
    const first = scroller();
    const remove = vi.spyOn(first, "removeEventListener");
    await render({ items: range(1, 10), surface: "b", initialItemId: "m5" });
    expect(scroller()).not.toBe(first);
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(scroller().scrollTop).toBe(400);
    await act(async () => userScroll(scroller(), 100));
    expect(firstVisible()?.id).toBe("m2");
    expect(anchoring.atBottom).toBe(false);
  });

  it("never reports atBottom before the list is positioned and measured", async () => {
    const seen = vi.fn();
    // Opening mid-history at the first unread: a read-marking effect must never see true.
    await render({ items: range(1, 20), initialItemId: "m3", seen });
    expect(scroller().scrollTop).toBe(200);
    expect(seen.mock.calls.map(([value]) => value)).toEqual([false]);
    expect(anchoring.measured).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    // Mounted hidden: unmeasured and not at the bottom until it has a box.
    const hidden = vi.fn();
    const items = range(1, 20);
    await render({ items, initialItemId: "m3", seen: hidden, viewport: 0 });
    expect(anchoring).toMatchObject({ atBottom: false, measured: false });
    await render({ items, initialItemId: "m3", seen: hidden, viewport: 300 });
    // Gaining a box is a resize: the observer positions the list.
    await act(async () => FakeResizeObserver.instances.at(-1)!.callback());
    expect(scroller().scrollTop).toBe(200);
    expect(hidden.mock.calls.every(([value]) => value === false)).toBe(true);
    expect(anchoring.measured).toBe(true);
  });

  it("positions a re-mounted scroller even when the items are the very same array", async () => {
    const items = range(1, 10);
    await render({ items, surface: "a" });
    expect(anchoring.atBottom).toBe(true);
    await act(async () => userScroll(scroller(), 0));
    // The owner swaps in a new scroll element, with the same items reference.
    await render({ items, surface: "b", initialItemId: "m5" });
    expect(scroller().scrollTop).toBe(400);
    expect(anchoring).toMatchObject({ atBottom: false, measured: true });
    const observer = FakeResizeObserver.instances.at(-1)!;
    expect(observer.observed.has(scroller())).toBe(true);
    expect(observer.observed.size).toBe(2);
  });

  it("works without ResizeObserver and cleans up on unmount", async () => {
    vi.stubGlobal("ResizeObserver", undefined);
    await render({ items: range(1, 10) });
    const element = scroller();
    const remove = vi.spyOn(element, "removeEventListener");
    await act(async () => root.unmount());
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    root = createRoot(container);
    expect(() => anchoring.scrollToBottom()).not.toThrow();
    expect(anchoring.scrollToItem("m1")).toBe(false);
  });

  it("disconnects its ResizeObserver on unmount", async () => {
    await render({ items: range(1, 3) });
    const [observer] = FakeResizeObserver.instances;
    await act(async () => root.unmount());
    expect(observer.observed.size).toBe(0);
    await act(async () => observer.callback());
    root = createRoot(container);
  });
});

it("server-renders unmeasured, not at the bottom, without touching the DOM", () => {
  const html = renderToString(<List items={range(1, 3)} />);
  expect(html).toContain('data-at-bottom="false"');
  expect(anchoring).toMatchObject({ atBottom: false, measured: false });
});
