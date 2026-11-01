// @vitest-environment node
import { expect, it, vi } from "vitest";

// Production entry points must stay usable without loading any synthetic transport/data or browser globals.
vi.mock("../fixtures", () => { throw new Error("Synthetic fixtures imported by the production composer entry"); });
vi.mock("./mockTransport", () => { throw new Error("Mock transport imported by the production composer entry"); });

it("loads the composer and its hooks without fixtures, browser globals, requests or timers", async () => {
  expect(typeof window).toBe("undefined");
  vi.useFakeTimers();
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    const { createChannelStore } = await import("./channel");
    const { createComposer } = await import("./composer");
    const hooks = await import("./hooks/composer");
    const { clearChannelDrafts } = await import("./channel-drafts");
    const composer = createComposer({ store: createChannelStore({ channelId: "c1", enabled: true }), me: { user: { id: "u1" }, flags: {} } });
    const release = composer.retain();
    composer.setDraft(null, { body: "No storage on the server" });
    expect(composer.draft(null).body).toBe("No storage on the server");
    release();
    clearChannelDrafts();
    expect(Object.values(hooks).every(hook => typeof hook === "function")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); fetch.mockRestore(); }
});
