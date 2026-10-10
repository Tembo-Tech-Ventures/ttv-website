import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Sidebar, { isSidebarLinkActive, SidebarCloseButton } from "./Sidebar";

describe("Sidebar", () => {
  it("renders the mobile close control as an accessible non-submit button", () => {
    const html = renderToStaticMarkup(
      <SidebarCloseButton onClose={vi.fn()} />
    );

    expect(html).toContain(
      '<button type="button" aria-label="Close navigation"'
    );
  });

  it("uses the server path to highlight a nested route", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        links={[
          { href: "/dashboard", label: "Home" },
          { href: "/dashboard/sessions", label: "Sessions" },
        ]}
        title="TTV Dashboard"
        currentPath="/dashboard/sessions/recording-1"
        isOpen={false}
        onClose={vi.fn()}
      />
    );

    expect(isSidebarLinkActive("/dashboard/sessions/recording-1", "/dashboard/sessions")).toBe(true);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).not.toContain("Prop className did not match");
  });

  it("shows an unread badge without making Logout active", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        links={[
          { href: "/dashboard/leads", label: "Leads", badge: 2 },
          { href: "/auth/logout", label: "Logout" },
        ]}
        title="TTV Dashboard"
        currentPath="/auth/logout"
        isOpen={false}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="2 unread"');
    expect(html).not.toContain('aria-current="page"');
  });
});
