// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { wheelScrollsList } from "./wheel";

/** A channel column: a header, the list (scrolled to 100) and a composer with a draft box. */
function column() {
  document.body.innerHTML = `
    <section data-column>
      <header data-header><h1>#help</h1><svg data-icon><path d="M0 0h1"></path></svg></header>
      <div data-channel-scroller style="overflow-y: auto"><p data-message>Hello</p></div>
      <form><textarea data-draft style="overflow-y: auto"></textarea></form>
    </section>`;
  const $ = (selector: string) => document.querySelector<HTMLElement>(selector)!;
  const list = $("[data-channel-scroller]");
  list.scrollTop = 100;
  return { main: $("[data-column]"), list, header: $("[data-header] h1"), message: $("[data-message]"), draft: $("[data-draft]") };
}

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  // happy-dom's WheelEvent leaves out the modifier keys of its init.
  Object.defineProperties(event, { target: { value: target }, ctrlKey: { value: init.ctrlKey ?? false } });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wheelScrollsList (QA2-17)", () => {
  it("scrolls the list when the wheel turns over the header", () => {
    const { main, list, header } = column();
    wheelScrollsList(wheel(header, { deltaY: 40 }), main);
    expect(list.scrollTop).toBe(140);
    wheelScrollsList(wheel(header, { deltaY: -3, deltaMode: 1 }), main);
    expect(list.scrollTop).toBe(92);
  });

  it("scrolls the list when the pointer is over an icon (an SVG, not an HTML element)", () => {
    const { main, list } = column();
    wheelScrollsList(wheel(document.querySelector("[data-icon] path")!, { deltaY: 40 }), main);
    expect(list.scrollTop).toBe(140);
  });

  it("leaves the list's own wheel, a zoom and a box that still scrolls itself to the browser", () => {
    const { main, list, message, header, draft } = column();
    wheelScrollsList(wheel(message, { deltaY: 40 }), main);
    expect(list.scrollTop).toBe(100);
    wheelScrollsList(wheel(header, { deltaY: 40, ctrlKey: true }), main);
    expect(list.scrollTop).toBe(100);
    Object.defineProperty(draft, "scrollHeight", { value: 500 });
    Object.defineProperty(draft, "clientHeight", { value: 100 });
    wheelScrollsList(wheel(draft, { deltaY: 40 }), main);
    expect(list.scrollTop).toBe(100);
  });
});
