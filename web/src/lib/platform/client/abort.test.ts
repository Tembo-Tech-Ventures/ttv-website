import { afterEach, expect, it, vi } from "vitest";
import { abortable, delay } from "./abort";

afterEach(() => vi.useRealTimers());
it("cleans listeners on resolve and rejection, and handles pre-aborted work", async () => {
  const c = new AbortController(); const remove = vi.spyOn(c.signal, "removeEventListener");
  expect(await abortable(Promise.resolve(1), c.signal)).toBe(1);
  await expect(abortable(Promise.reject(new Error("failed")), c.signal)).rejects.toThrow("failed");
  await Promise.resolve(); expect(remove).toHaveBeenCalledTimes(2);
  c.abort(); await expect(abortable(Promise.reject(new Error("late")), c.signal)).rejects.toMatchObject({ name: "AbortError" });
});
it("aborts bounded waits without leaving a timer", async () => {
  vi.useFakeTimers();
  const c = new AbortController(); const result = delay(200, c.signal).catch(error => error);
  await vi.advanceTimersByTimeAsync(100); expect(vi.getTimerCount()).toBe(1);
  c.abort(); expect(await result).toMatchObject({ name: "AbortError" }); expect(vi.getTimerCount()).toBe(0);
});
it.each([-1, NaN, Infinity, 2_147_483_648])("rejects an invalid delay %s", ms => {
  expect(() => delay(ms)).toThrow(RangeError);
});
