import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarCloseButton } from "./Sidebar";

describe("Sidebar", () => {
  it("renders the mobile close control as an accessible non-submit button", () => {
    const html = renderToStaticMarkup(
      <SidebarCloseButton onClose={vi.fn()} />
    );

    expect(html).toContain(
      '<button type="button" aria-label="Close navigation"'
    );
  });
});
