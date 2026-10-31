// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attention, attentionCount } from "../../fixtures";
import { createAttentionStore } from "../attention";
import { useAttention, useAttentionBadge, useAttentionCount } from "./attention";

describe("attention hooks", () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("shares one poll lifecycle across badges/panel, supports mock actions and aborts at last unmount", async () => {
    const store = createAttentionStore({ enabled: true, mock: true, initialList: attention, initialCounts: attentionCount });
    const retain = vi.spyOn(store, "retain"); const subscribe = vi.spyOn(store, "subscribe");
    function Count() { return <span>{useAttentionCount(store)}</span>; }
    function Badge() { return <span>{useAttentionBadge(store, "community")}</span>; }
    function Panel() { return <span>{useAttention(store, state => state.announcement)}</span>; }
    await act(async () => root.render(<><Count /><Badge /><Panel /></>));
    expect(container.textContent).toBe("42"); expect(retain).toHaveBeenCalledTimes(3); expect(subscribe).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => { await store.markRead({ ids: [attention.items[0].id] }); });
    expect(container.textContent).toBe("31Attention marked read");
    await act(async () => root.render(<Count />)); expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
    const state = store.getState(); await act(async () => vi.advanceTimersByTimeAsync(600_000)); expect(store.getState()).toBe(state);
  });

  it("restarts cleanly in StrictMode and switches store/space without cross-user state", async () => {
    const first = createAttentionStore({ enabled: true, mock: true, initialCounts: attentionCount });
    const second = createAttentionStore({ enabled: false });
    function View({ store = first, space = "cohort" as const }) { return <span>{useAttentionBadge(store, space)}</span>; }
    await act(async () => root.render(<StrictMode><View /></StrictMode>)); expect(container.textContent).toBe("2");
    await act(async () => root.render(<StrictMode><View store={second} /></StrictMode>)); expect(container.textContent).toBe("0"); expect(vi.getTimerCount()).toBe(0);
    await act(async () => root.render(<StrictMode><View /></StrictMode>)); expect(container.textContent).toBe("2"); expect(vi.getTimerCount()).toBe(1);
  });
});
