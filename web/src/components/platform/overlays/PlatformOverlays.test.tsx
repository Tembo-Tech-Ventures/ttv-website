// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meByPersona } from "@/lib/platform/fixtures";
import { onShellOverlay, requestAttentionRefresh, requestShellOverlay, type ShellOverlayRequest } from "@/components/platform/shell/overlays";
import { RECENT_PREFIX, recentSearchKey } from "@/components/platform/search/recent-searches";

/*
 * PlatformOverlays (S7): neither panel is in the page's first download. These stand in for the two
 * panels and record what reaches them, so the test is about when they load and what they are told.
 */
const seen = vi.hoisted(() => ({
  search: [] as { trigger: HTMLElement | null }[],
  attention: [] as { countNow: boolean }[],
  attentionRequests: [] as { trigger: HTMLElement | null }[],
}));
vi.mock("@/components/platform/search/SearchOverlay", () => {
  return {
    default: function SearchStub() {
      useEffect(() => onShellOverlay("search", (request: ShellOverlayRequest) => seen.search.push({ trigger: request.trigger })), []);
      return <div data-search-stub />;
    },
  };
});
vi.mock("./AttentionOverlay", () => {
  return {
    default: function AttentionStub({ countNow }: { countNow: boolean }) {
      seen.attention.push({ countNow });
      useEffect(() => onShellOverlay("attention", (request: ShellOverlayRequest) => seen.attentionRequests.push({ trigger: request.trigger })), []);
      return <div data-attention-stub />;
    },
  };
});

const { default: PlatformOverlays, FIRST_COUNT_MS } = await import("./PlatformOverlays");

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.assign(seen, { search: [], attention: [], attentionRequests: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** Lets an import() and the renders after it settle. */
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => { setTimeout(resolve, 0); }); });

async function mount(props: { attention?: boolean } = {}) {
  await act(async () => root.render(<PlatformOverlays me={meByPersona.lucy} {...props} />));
}

describe("PlatformOverlays", () => {
  it("renders neither panel at first, only attention's live region", async () => {
    await mount();
    expect(container.querySelector("[data-search-stub]")).toBeNull();
    expect(container.querySelector("[data-attention-stub]")).toBeNull();
    expect(container.querySelector('[data-live-regions="attention"]')).not.toBeNull();
  });

  it("loads search on its first request and hands it that request, trigger and all", async () => {
    await mount();
    const trigger = document.createElement("button");
    await act(async () => requestShellOverlay({ overlay: "search", trigger, via: "shortcut" }));
    await settle();
    expect(container.querySelector("[data-search-stub]")).not.toBeNull();
    expect(seen.search).toEqual([{ trigger }]);
    // Once loaded, search hears later requests itself, once each.
    await act(async () => requestShellOverlay({ overlay: "search", trigger: null, via: "click" }));
    expect(seen.search).toHaveLength(2);
  });

  it("loads attention on the bell without an extra count: the counts it starts from are fresh", async () => {
    await mount();
    const bell = document.createElement("button");
    await act(async () => requestShellOverlay({ overlay: "attention", trigger: bell, via: "click" }));
    await settle();
    expect(seen.attention.at(-1)).toEqual({ countNow: false });
    expect(seen.attentionRequests).toEqual([{ trigger: bell }]);
  });

  it("loads attention when its first count falls due, and counts at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await mount();
    await act(async () => { vi.advanceTimersByTime(FIRST_COUNT_MS - 1); });
    expect(container.querySelector("[data-attention-stub]")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    vi.useRealTimers();
    await settle();
    expect(seen.attention.at(-1)).toEqual({ countNow: true });
  });

  it("waits for the page to be seen before a count that fell due while it was hidden", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await mount();
    await act(async () => { vi.advanceTimersByTime(FIRST_COUNT_MS); });
    vi.useRealTimers();
    await settle();
    expect(container.querySelector("[data-attention-stub]")).toBeNull();
    hidden.mockReturnValue(false);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(seen.attention.at(-1)).toEqual({ countNow: true });
    hidden.mockRestore();
  });

  it("loads attention, counting at once, when the person comes back to the tab before the count was due", async () => {
    await mount();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(seen.attention.at(-1)).toEqual({ countNow: true });
  });

  it("keeps recent searches to this person, and forgets them all on sign-out, before search ever loads", async () => {
    localStorage.setItem(recentSearchKey("someone-else"), '["theirs"]');
    localStorage.setItem(recentSearchKey(meByPersona.lucy.user.id), '["mine"]');
    await mount();
    const kept = () => Object.keys(localStorage).filter((key) => key.startsWith(RECENT_PREFIX)).toSorted();
    expect(kept()).toEqual([recentSearchKey(meByPersona.lucy.user.id)]);
    const form = document.createElement("form");
    form.setAttribute("data-shell-sign-out", "");
    document.body.appendChild(form);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(kept()).toEqual([]);
    expect(container.querySelector("[data-search-stub]")).toBeNull();
    form.remove();
  });

  it("loads attention when another island asks for a count (QA4-07)", async () => {
    await mount();
    await act(async () => requestAttentionRefresh());
    await settle();
    expect(seen.attention.at(-1)).toEqual({ countNow: true });
  });

  it("leaves attention to the attention page, which owns its own inbox", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await mount({ attention: false });
    await act(async () => { vi.advanceTimersByTime(FIRST_COUNT_MS); });
    vi.useRealTimers();
    await act(async () => requestAttentionRefresh());
    await settle();
    expect(container.querySelector("[data-attention-stub]")).toBeNull();
    expect(container.querySelector('[data-live-regions="attention"]')).toBeNull();
  });
});
