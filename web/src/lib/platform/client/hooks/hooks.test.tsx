// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createStore, useStore } from "../store";
import { useVisibilityPolling } from "./useVisibilityPolling";

describe("React store and polling lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("suppresses selector-equal renders, handles selector/store changes, and unsubscribes", async () => {
    const first = createStore({ count: 0, other: 0 }); const second = createStore({ count: 10, other: 0 });
    let renders = 0;
    const equal = (a: { value: number }, b: { value: number }) => a.value === b.value;
    function View({ store = first, offset = 0 }) {
      const selected = useStore(store, state => ({ value: state.count + offset }), equal);
      renders++; return <span>{selected.value}</span>;
    }
    await act(async () => root.render(<View />)); const baseline = renders;
    await act(async () => first.setState(s => ({ ...s, other: 1 })));
    expect(renders).toBe(baseline);
    await act(async () => first.setState(s => ({ ...s, count: 1 })));
    expect(container.textContent).toBe("1");
    await act(async () => root.render(<View offset={2} />)); expect(container.textContent).toBe("3");
    await act(async () => root.render(<View store={second} />)); expect(container.textContent).toBe("10");
    const afterSwitch = renders; await act(async () => first.setState({ count: 99, other: 0 })); expect(renders).toBe(afterSwitch);
  });

  it("uses Object.is by default and observes updates between render and subscription", async () => {
    const store = createStore(1);
    const original = store.subscribe;
    const stop = vi.fn();
    vi.spyOn(store, "subscribe").mockImplementation(listener => {
      store.setState(2);
      const unsubscribe = original(listener);
      return () => { stop(); unsubscribe(); };
    });
    function View() { return <span>{useStore(store, value => value)}</span>; }
    await act(async () => root.render(<View />));
    expect(container.textContent).toBe("2");
    await act(async () => store.setState(3)); expect(container.textContent).toBe("3");
    await act(async () => root.unmount()); expect(stop).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("uses fresh run callbacks without restarting, resumes on focus, aborts and stops on unmount", async () => {
    const one = vi.fn(async (_signal: AbortSignal) => ({ changed: true }));
    const two = vi.fn(async (_signal: AbortSignal) => ({ changed: true }));
    function View({ run = one, intervalMs = 100, isActive }: { run?: typeof one; intervalMs?: number; isActive?: () => boolean }) {
      useVisibilityPolling({ run, intervalMs, isActive }); return null;
    }
    await act(async () => root.render(<View />)); expect(one).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<View run={two} />)); expect(two).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(100)); expect(two).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); }); expect(two).toHaveBeenCalledTimes(2);
    await act(async () => root.render(<View run={two} intervalMs={200} isActive={() => false} />));
    await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(two).toHaveBeenCalledTimes(2);
    const slow = vi.fn((_signal: AbortSignal) => new Promise<{ changed: boolean }>(() => {}));
    await act(async () => root.render(<View run={slow} intervalMs={300} />));
    expect(slow).toHaveBeenCalledTimes(1);
    const signal = slow.mock.calls[0][0];
    await act(async () => root.unmount()); expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it("never overlaps work across interval changes, enabled toggles or a cancelled queued run", async () => {
    let resolve!: (result: { changed: boolean }) => void;
    const slow = vi.fn((_signal: AbortSignal) => new Promise<{ changed: boolean }>(yes => { resolve = yes; }));
    const next = vi.fn(async (_signal: AbortSignal) => ({ changed: true }));
    let refresh = () => {};
    function View({ intervalMs = 100, enabled = true, run = next }) {
      refresh = useVisibilityPolling({ run, intervalMs, enabled }); return null;
    }
    await act(async () => root.render(<View run={slow} />));
    await act(async () => root.render(<View intervalMs={200} />)); expect(next).not.toHaveBeenCalled();
    await act(async () => root.render(<View intervalMs={300} />)); expect(next).not.toHaveBeenCalled();
    await act(async () => { resolve({ changed: true }); }); expect(next).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<View intervalMs={300} enabled={false} />));
    await act(async () => { refresh(); await vi.advanceTimersByTimeAsync(1000); }); expect(next).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<View intervalMs={300} />)); expect(next).toHaveBeenCalledTimes(2);
    await act(async () => { refresh(); }); expect(next).toHaveBeenCalledTimes(3);
  });
});
