import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DashboardShell from "./DashboardShell";

describe("dashboard shell hydration", () => {
  it("keeps the mobile opener disabled until the client handler is ready", () => {
    const html = renderToStaticMarkup(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    );

    expect(html).toMatch(/aria-label="Open navigation"/);
    expect(html).toMatch(/disabled=""/);
  });

  it("renders aria-expanded on the mobile opener", () => {
    const html = renderToStaticMarkup(
      <DashboardShell>
        <div>Dashboard content</div>
      </DashboardShell>
    );

    expect(html).toMatch(/aria-expanded="false"/);
  });
});
