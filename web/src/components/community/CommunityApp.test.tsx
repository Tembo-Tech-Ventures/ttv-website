// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommunityApp from "./CommunityApp";
import { parseJourneyInitial } from "./community-client";

// What the Community page reads on the server (journey-initial-server.ts), from fictional API bodies.
const initial = parseJourneyInitial(
  { isAdmin: false, isInstitution: false, isMentor: false },
  { profile: { userId: "wanjiru", name: "Wanjiru Kamau", image: null, headline: "Builder", bio: "Builds M-Pesa reconciliation tools", skills: ["TypeScript"], opportunityGoals: "First developer role", version: 2, updatedAt: 1793000000 } },
  { entries: [{ id: "ledger", userId: "wanjiru", title: "Chama savings ledger", description: "Built and tested a fictional ledger.", evidenceUrl: "https://github.com/example/ledger", occurredAt: "2026-10-24", visibility: "institution", version: 1,
    confirmations: [{ id: "c1", mentorName: "Otieno Ouma", mentorRole: "MENTOR", statement: "Walked through the tests.", method: "Code review", journeyVersion: 1, createdAt: 1793000000 }] }] },
)!;

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

  it("renders the journey from the page's data instead of loading it", () => {
    const html = renderToStaticMarkup(<CommunityApp view="journey" embedded initial={initial} />);
    expect(html).not.toContain("Loading your workspace");
    expect(html).toContain("Chama savings ledger");
    expect(html).toContain("Wanjiru Kamau");
  });

  it("hydrates the page's journey without a mismatch or a request", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const consoleError = vi.spyOn(console, "error");
    const recoverable = vi.fn();
    const app = <CommunityApp view="journey" embedded framing="member" initial={initial} />;
    const host = document.createElement("div");
    host.innerHTML = renderToString(app);
    const rendered = host.innerHTML;
    document.body.appendChild(host);
    const root = await act(async () => hydrateRoot(host, app, { onRecoverableError: recoverable }));
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe(rendered);
    await act(async () => root.unmount());
    host.remove();
    consoleError.mockRestore();
  });

  it("loads as before without the page's data, and for the other views", () => {
    expect(renderToStaticMarkup(<CommunityApp view="journey" embedded initial={null} />)).toContain("Loading your workspace");
    expect(renderToStaticMarkup(<CommunityApp view="mentor" embedded initial={initial} />)).toContain("Loading your workspace");
  });
});
