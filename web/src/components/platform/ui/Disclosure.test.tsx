import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Disclosure from "./Disclosure";

function render(markup: string) {
  const { document } = new Window();
  document.body.innerHTML = markup;
  return document.body.querySelector("details")!;
}

describe("Disclosure", () => {
  it("is a native details whose summary names it, so it opens without JavaScript", () => {
    const details = render(renderToStaticMarkup(<Disclosure summary="Where to get this credential">Steps.</Disclosure>));
    expect(details.hasAttribute("data-disclosure")).toBe(true);
    expect(details.hasAttribute("open")).toBe(false);
    const summary = details.querySelector(":scope > summary")!;
    expect(summary.textContent).toBe("Where to get this credential");
    expect(details.querySelector(":scope > div")?.textContent).toBe("Steps.");
  });

  it("opens on arrival when asked, and stays closed otherwise", () => {
    expect(render(renderToStaticMarkup(<Disclosure summary="Help" open>Steps.</Disclosure>)).hasAttribute("open")).toBe(true);
    expect(render(renderToStaticMarkup(<Disclosure summary="Help" open={false}>Steps.</Disclosure>)).hasAttribute("open")).toBe(false);
  });

  it("gives its row the kit's focus ring and a 44px target on touch, with the caret hidden from readers", () => {
    const summary = render(renderToStaticMarkup(<Disclosure summary="Help">Steps.</Disclosure>)).querySelector("summary")!;
    const classes = summary.getAttribute("class") ?? "";
    expect(classes).toContain("focus-visible:outline-peach-ink");
    expect(classes).toContain("pointer-coarse:min-h-11");
    expect(classes).toContain("list-none");
    expect(summary.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
