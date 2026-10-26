import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("./HomeMotionGate.astro", import.meta.url), "utf8").match(/<script is:inline>([\s\S]*?)<\/script>/)![1];
function run(load?: () => Promise<unknown>) {
  const classes = new Set<string>();
  runInNewContext(source, {
    document: {
      documentElement: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } },
      fonts: load ? { load } : undefined,
    },
    setTimeout, clearTimeout, Promise,
  });
  return classes;
}
afterEach(() => vi.useRealTimers());

describe("pre-paint homepage font gate", () => {
  it("releases the CSS entrance when the required fonts load", async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => Promise.resolve([]));
    const classes = run(load);
    expect(classes.has("home-motion-wait")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(classes.has("home-motion-wait")).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never holds an entrance longer than 500ms for stalled font requests", async () => {
    vi.useFakeTimers();
    const classes = run(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(499);
    expect(classes.has("home-motion-wait")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(classes.has("home-motion-wait")).toBe(false);
  });
  it("releases immediately on font failure or an unsupported font-loading API", async () => {
    vi.useFakeTimers();
    const classes = run(() => Promise.reject(new Error("font unavailable")));
    await vi.advanceTimersByTimeAsync(0);
    expect(classes.has("home-motion-wait")).toBe(false);
    expect(run().has("home-motion-wait")).toBe(false);
  });
});
