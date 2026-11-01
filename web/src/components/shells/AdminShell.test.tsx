import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminShell, { getAdminLinks } from "./AdminShell";

describe("admin navigation", () => {
  it("links to curriculum management for every admin", () => {
    for (const agentAuthEnabled of [false, true]) {
      expect(getAdminLinks(agentAuthEnabled)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            href: "/admin/curricula",
            label: "Curricula",
          }),
        ])
      );
    }
  });

  it("always shows the integrations link for every admin", () => {
    for (const agentAuthEnabled of [false, true]) {
      expect(getAdminLinks(agentAuthEnabled)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            href: "/admin/settings/integrations",
            label: "Integrations",
          }),
        ])
      );
    }
  });

  it("always exposes personal access token management to browser-authenticated admins", () => {
    for (const agentAuthEnabled of [false, true]) {
      expect(getAdminLinks(agentAuthEnabled)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            href: "/admin/personal-access-tokens",
            label: "Personal Access Tokens",
          }),
        ])
      );
    }
  });

  it("places curricula before cohorts in the management flow", () => {
    const labels = getAdminLinks(false).map(({ label }) => label);
    expect(labels.indexOf("Curricula")).toBeLessThan(
      labels.indexOf("Cohorts")
    );
  });

  it("shows agent access only when the runtime capability is enabled", () => {
    expect(getAdminLinks(false).map(({ label }) => label)).not.toContain(
      "Agent Access"
    );
    expect(getAdminLinks(true).map(({ label }) => label)).toContain(
      "Agent Access"
    );
  });

  it("shows data migration only when its independent capability is enabled", () => {
    expect(getAdminLinks(false).map(({ label }) => label)).not.toContain(
      "Data Migration"
    );
    expect(getAdminLinks(false, true).map(({ label }) => label)).toContain(
      "Data Migration"
    );
    expect(getAdminLinks(false, false).map(({ label }) => label)).not.toContain(
      "Data Migration"
    );
    const agentOnlyLabels = getAdminLinks(true, false).map(({ label }) => label);
    expect(agentOnlyLabels).not.toContain("Data Migration");
    expect(agentOnlyLabels).toContain("Agent Access");
  });
});

describe("access requests in the admin navigation", () => {
  it("comes straight after admin home", () => {
    const labels = getAdminLinks(false).map(({ label }) => label);
    expect(labels.indexOf("Access requests")).toBe(labels.indexOf("Admin Home") + 1);
  });

  it("counts the requests waiting, and says what it counts", () => {
    expect(getAdminLinks(false, false, false, 3)).toContainEqual(
      expect.objectContaining({ href: "/admin/access-requests", badge: 3, badgeLabel: "pending" })
    );
    const html = renderToStaticMarkup(
      <AdminShell currentPath="/admin/access-requests" pendingAccessRequests={3}>
        <div>Admin content</div>
      </AdminShell>
    );
    expect(html).toContain('<span class="sr-only">3 pending</span>');
  });

  it("shows no count when nothing is waiting", () => {
    const html = renderToStaticMarkup(
      <AdminShell currentPath="/admin">
        <div>Admin content</div>
      </AdminShell>
    );
    expect(html).toContain('href="/admin/access-requests"');
    expect(html).not.toContain("pending</span>");
  });
});

describe("admin shell ways in and out", () => {
  it("offers the way back to the dashboard first", () => {
    expect(getAdminLinks(false)[0]).toEqual(expect.objectContaining({ href: "/dashboard", label: "Back to dashboard" }));
  });

  it("starts with a skip link to the main content", () => {
    const html = renderToStaticMarkup(
      <AdminShell>
        <div>Admin content</div>
      </AdminShell>
    );
    const firstLink = html.match(/<a [^>]*>[^<]*<\/a>/)?.[0] ?? "";
    expect(firstLink).toContain('href="#admin-main"');
    expect(firstLink).toContain("Skip to content");
    expect(html).toContain('<main id="admin-main" tabindex="-1"');
  });
});

describe("admin shell hydration", () => {
  it("keeps the mobile opener disabled until the client handler is ready", () => {
    const html = renderToStaticMarkup(
      <AdminShell>
        <div>Admin content</div>
      </AdminShell>
    );

    expect(html).toMatch(/aria-label="Open navigation"/);
    expect(html).toMatch(/disabled=""/);
  });

  it("renders aria-expanded on the mobile opener", () => {
    const html = renderToStaticMarkup(
      <AdminShell>
        <div>Admin content</div>
      </AdminShell>
    );

    expect(html).toMatch(/aria-expanded="false"/);
  });
});

it("exposes staging demo personas only with the server-computed staging gate", () => {
  expect(getAdminLinks(false,false).some(link=>link.href==="/demo")).toBe(false);
  expect(getAdminLinks(false,false,true)).toContainEqual(expect.objectContaining({href:"/demo",label:"Staging demo personas"}));
});
