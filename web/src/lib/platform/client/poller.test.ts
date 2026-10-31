import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPoller } from "./poller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("visibility-aware poller", () => {
  let doc: EventTarget & { hidden: boolean };
  let win: EventTarget;
  const pollers: ReturnType<typeof createPoller>[] = [];
  function poll(options: Parameters<typeof createPoller>[0]) {
    const poller = createPoller(options); pollers.push(poller); return poller;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    doc = Object.assign(new EventTarget(), { hidden: false }); win = new EventTarget();
    vi.stubGlobal("document", doc); vi.stubGlobal("window", win);
  });
  afterEach(() => { pollers.splice(0).forEach(p => p.stop()); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("starts immediately, backs off while idle up to a cap, and resets on change", async () => {
    const run = vi.fn().mockResolvedValue({ changed: false });
    const p = poll({ run, intervalMs: 100, maxIntervalMs: 300, backoff: 2 }); p.start(); p.start();
    await vi.advanceTimersByTimeAsync(199); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300); expect(run).toHaveBeenCalledTimes(3);
    run.mockResolvedValue({ changed: true });
    await vi.advanceTimersByTimeAsync(300); expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(99); expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(5);
    p.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap slow runs; coalesces focus refreshes after completion", async () => {
    const pending = deferred<{ changed: boolean }>();
    const run = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ changed: true });
    const p = poll({ run, intervalMs: 100 }); p.start();
    await vi.advanceTimersByTimeAsync(1000); expect(run).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("focus")); win.dispatchEvent(new Event("focus"));
    expect(run).toHaveBeenCalledTimes(1);
    pending.resolve({ changed: false }); await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not run hidden; immediately resumes on visibility and focus", async () => {
    doc.hidden = true;
    const run = vi.fn().mockResolvedValue({ changed: true });
    const p = poll({ run, intervalMs: 100 }); p.start();
    await vi.advanceTimersByTimeAsync(1000); expect(run).not.toHaveBeenCalled();
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"));
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    win.dispatchEvent(new Event("focus")); expect(run).toHaveBeenCalledTimes(1);
    doc.hidden = false; win.dispatchEvent(new Event("focus"));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("aborts hidden work and waits for an uncooperative old run before resuming", async () => {
    const pending = deferred<{ changed: boolean }>();
    const run = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ changed: true });
    const p = poll({ run, intervalMs: 100 }); p.start();
    const signal = run.mock.calls[0][0] as AbortSignal;
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange")); expect(signal.aborted).toBe(true);
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"));
    expect(run).toHaveBeenCalledTimes(1);
    pending.resolve({ changed: false }); await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100); expect(run).toHaveBeenCalledTimes(3);
  });

  it("backs off after synchronous and asynchronous errors, without unhandled rejection", async () => {
    const run = vi.fn().mockImplementationOnce(() => { throw new Error("sync"); })
      .mockRejectedValueOnce(new Error("async")).mockResolvedValue({ changed: true });
    const p = poll({ run, intervalMs: 100 }); p.start();
    await vi.advanceTimersByTimeAsync(199); expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(399); expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledTimes(3);
  });

  it("stop removes listeners, timers and aborts work; stale rejection cannot restart", async () => {
    const pending = deferred<{ changed: boolean }>();
    const run = vi.fn().mockReturnValue(pending.promise);
    const removeDoc = vi.spyOn(doc, "removeEventListener"); const removeWin = vi.spyOn(win, "removeEventListener");
    const p = poll({ run, intervalMs: 100 }); p.refresh(); p.start(); p.stop(); p.stop(); p.refresh();
    expect((run.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
    expect(removeDoc).toHaveBeenCalledWith("visibilitychange", p.refresh);
    expect(removeWin).toHaveBeenCalledWith("focus", p.refresh);
    pending.reject(new Error("aborted")); await vi.advanceTimersByTimeAsync(5000);
    win.dispatchEvent(new Event("focus")); expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restart still waits for the stopped run, then starts at the base interval", async () => {
    const pending = deferred<{ changed: boolean }>();
    const run = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ changed: true });
    const p = poll({ run, intervalMs: 100 }); p.start(); p.stop(); p.start();
    expect(run).toHaveBeenCalledTimes(1);
    pending.reject(new Error("old run")); await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("re-evaluates custom activity when a timer fires and on explicit refresh", async () => {
    let enabled = true;
    const run = vi.fn().mockResolvedValue({ changed: true });
    const p = poll({ run, intervalMs: 100, isActive: () => enabled }); p.start();
    await vi.advanceTimersByTimeAsync(0); enabled = false;
    await vi.advanceTimersByTimeAsync(100); expect(run).toHaveBeenCalledTimes(1);
    p.refresh(); expect(run).toHaveBeenCalledTimes(1);
    enabled = true; p.refresh(); expect(run).toHaveBeenCalledTimes(2);
    enabled = false; await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
  });

  it("works without browser globals", async () => {
    vi.stubGlobal("document", undefined); vi.stubGlobal("window", undefined);
    const run = vi.fn().mockResolvedValue({ changed: true });
    const p = poll({ run, intervalMs: 100 }); p.start(); await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(2); p.stop();
  });

  it.each([
    { intervalMs: 0 }, { intervalMs: Infinity }, { intervalMs: 100, maxIntervalMs: 99 },
    { intervalMs: 1, maxIntervalMs: Infinity }, { intervalMs: 1, maxIntervalMs: 2_147_483_648 },
    { intervalMs: 1, backoff: 0.5 }, { intervalMs: 1, backoff: NaN },
  ])("rejects invalid settings: %j", options => {
    expect(() => createPoller({ run: () => ({ changed: true }), ...options })).toThrow(RangeError);
  });
});
