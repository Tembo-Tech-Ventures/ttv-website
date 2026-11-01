// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommunityApp from "./CommunityApp";

afterEach(() => vi.unstubAllGlobals());

describe("CommunityApp", () => {
  it("keeps its own frame on its own", () => {
    const html = renderToStaticMarkup(<CommunityApp view="journey" />);
    expect(html).toContain("Loading your workspace");
    expect(html).toContain("Dashboard ↗");
  });

  it("drops its frame inside the spaces shell, so there is no link back to the page it is on", () => {
    const html = renderToStaticMarkup(<CommunityApp view="journey" embedded />);
    expect(html).toContain("Loading your workspace");
    expect(html).toContain("data-embedded");
    expect(html).not.toContain("Dashboard ↗");
  });

  it("offers the private set-aside on the spaces Confirm page only", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const entry = {
      id: "entry", userId: "member", memberName: "Fictional Member", title: "Chama savings ledger", description: "Built a fictional ledger.",
      evidenceUrl: null, occurredAt: "2026-10-20", visibility: "institution", version: 1, confirmations: [], reviewedByCurrentMentor: false, setAsideByCurrentMentor: false,
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/access")
      ? { isAdmin: false, isInstitution: false, isMentor: true }
      : { entries: [entry] })));
    for (const embedded of [true, false]) {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => root.render(<CommunityApp view="mentor" embedded={embedded} />));
      expect(host.textContent).toContain("Chama savings ledger");
      expect(host.textContent?.includes("Set aside: I can't confirm this")).toBe(embedded);
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
