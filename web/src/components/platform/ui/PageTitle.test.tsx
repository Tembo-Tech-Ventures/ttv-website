// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PageTitle from "./PageTitle";

describe("PageTitle", () => {
  it("hands its heading to a ref, focusable when asked, so a page can move focus to its title", async () => {
    const ref = createRef<HTMLHeadingElement>();
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<PageTitle ref={ref} id="title" tabIndex={-1}>Needs your attention</PageTitle>));
    expect(ref.current?.tagName).toBe("H1");
    expect(ref.current?.tabIndex).toBe(-1);
    expect(ref.current?.id).toBe("title");
    await act(async () => root.unmount());
  });

  it("is not focusable unless asked", () => {
    expect(renderToStaticMarkup(<PageTitle>Programs</PageTitle>)).not.toContain("tabindex");
  });
});
