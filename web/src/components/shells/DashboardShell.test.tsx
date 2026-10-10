import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DashboardShell, { getDashboardLinks } from "./DashboardShell";

const BASE_LINKS = ["home", "apply", "ask", "account", "logout"] as const;

describe("dashboard shell hydration", () => {
  it("keeps the mobile opener disabled until the client handler is ready", () => {
    const html = renderToStaticMarkup(
      <DashboardShell currentPath="/dashboard" visibleLinkIds={[...BASE_LINKS]}>
        <div>Dashboard content</div>
      </DashboardShell>
    );

    expect(html).toMatch(/aria-label="Open navigation"/);
    expect(html).toMatch(/disabled=""/);
  });

  it("renders aria-expanded on the mobile opener", () => {
    const html = renderToStaticMarkup(
      <DashboardShell currentPath="/dashboard" visibleLinkIds={[...BASE_LINKS]}>
        <div>Dashboard content</div>
      </DashboardShell>
    );

    expect(html).toMatch(/aria-expanded="false"/);
  });

  it("renders only the server-derived links and always keeps logout", () => {
    const html = renderToStaticMarkup(
      <DashboardShell currentPath="/dashboard" visibleLinkIds={[...BASE_LINKS]}>
        <div>Dashboard content</div>
      </DashboardShell>
    );

    expect(html).toContain('href="/dashboard/apply"');
    expect(html).toContain('href="/dashboard/ask"');
    expect(html).toContain('href="/dashboard/profile"');
    expect(html).toContain('href="/auth/logout"');
    expect(html).not.toContain('href="/dashboard/sessions"');
    expect(html).not.toContain('href="/dashboard/portfolio"');
    expect(html).not.toContain('href="/dashboard/writing"');
  });

  it("adds the unread count only to a visible Leads link", () => {
    const links = getDashboardLinks(
      [...BASE_LINKS, "leads"],
      4
    );

    expect(links.find((link) => link.id === "leads")?.badge).toBe(4);
    expect(links.find((link) => link.id === "logout")).toBeDefined();
  });

  it("uses a non-heading mobile title so the shell has one h1", () => {
    const html = renderToStaticMarkup(
      <DashboardShell currentPath="/dashboard" visibleLinkIds={[...BASE_LINKS]}>
        <h2>Page title</h2>
      </DashboardShell>
    );

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(">TTV Dashboard</span>");
  });
});
