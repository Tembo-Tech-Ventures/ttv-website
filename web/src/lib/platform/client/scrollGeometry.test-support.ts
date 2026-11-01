/**
 * A tiny layout model for DOM tests (happy-dom has no layout). A scroll container
 * is marked `data-viewport="<px>"`; every element marked `data-height="<px>"`
 * inside it is a block stacked in document order. scrollTop is clamped as a
 * browser would; getBoundingClientRect reflects it.
 */
const scrollTops = new WeakMap<Element, number>();
const viewport = (element: Element) => element.closest<HTMLElement>("[data-viewport]");
const height = (element: Element) => Number((element as HTMLElement).dataset.height ?? 0);
const blocks = (container: Element) => Array.from(container.querySelectorAll("[data-height]"));
const contentHeight = (container: Element) => blocks(container).reduce((sum, block) => sum + height(block), 0);
const rect = (top: number, size: number) => ({ top, bottom: top + size, height: size, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() { return this; } }) as DOMRect;

export function installScrollGeometry(): () => void {
  const prototype = HTMLElement.prototype;
  const saved = (["clientHeight", "scrollHeight", "scrollTop"] as const).map(name => [name, Object.getOwnPropertyDescriptor(prototype, name) ?? Object.getOwnPropertyDescriptor(Element.prototype, name)] as const);
  const savedRect = prototype.getBoundingClientRect;
  Object.defineProperties(prototype, {
    clientHeight: { configurable: true, get(this: HTMLElement) { return this.dataset.viewport ? Number(this.dataset.viewport) : height(this); } },
    scrollHeight: { configurable: true, get(this: HTMLElement) { return this.dataset.viewport ? Math.max(contentHeight(this), Number(this.dataset.viewport)) : height(this); } },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) { return scrollTops.get(this) ?? 0; },
      set(this: HTMLElement, value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        scrollTops.set(this, Math.min(max, Math.max(0, value)));
      },
    },
  });
  prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.viewport) return rect(0, Number(this.dataset.viewport));
    const container = viewport(this);
    if (!container) return rect(0, 0);
    let top = 0;
    for (const block of blocks(container)) {
      if (block === this || block.contains(this)) break;
      // A block containing this one does not push it down; nested blocks are counted by their own heights.
      if (!this.contains(block)) top += height(block);
    }
    return rect(top - container.scrollTop, height(this));
  };
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor);
      else Reflect.deleteProperty(prototype, name);
    }
    prototype.getBoundingClientRect = savedRect;
  };
}

/** A user scroll: set the position and fire the event the browser would. */
export function userScroll(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  element.dispatchEvent(new Event("scroll"));
}
