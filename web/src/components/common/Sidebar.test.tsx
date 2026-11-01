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

  it("supports a server-owned active alias for application details", () => {
    expect(
      isSidebarLinkActive(
        "/dashboard/application/application-1",
        "/dashboard/apply",
        ["/dashboard/application"]
      )
    ).toBe(true);
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

    expect(html).toContain('<span aria-hidden="true">2</span><span class="sr-only">2 unread</span>');
    expect(html).not.toContain("aria-label=\"2");
    expect(html).not.toContain('aria-current="page"');
  });

  it("says what a badge counts when the link names it", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        links={[{ href: "/admin/access-requests", label: "Access requests", badge: 3, badgeLabel: "pending" }]}
        title="TTV Admin"
        currentPath="/admin"
        isOpen={false}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('<span class="sr-only">3 pending</span>');
    expect(html).not.toContain("unread");
  });

  it("shows no badge for a count of zero", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        links={[{ href: "/admin/access-requests", label: "Access requests", badge: 0, badgeLabel: "pending" }]}
        title="TTV Admin"
        currentPath="/admin"
        isOpen={false}
        onClose={vi.fn()}
      />
    );

    expect(html).not.toContain("pending");
  });
});
