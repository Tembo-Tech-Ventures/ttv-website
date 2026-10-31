// @vitest-environment node
import { expect, it, vi } from "vitest";

it("imports every public client module without browser globals or side effects", async () => {
  expect(typeof window).toBe("undefined"); expect(typeof document).toBe("undefined");
  vi.useFakeTimers();
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  try {
    const client = await import("./index");
    expect(client.createStore(1).getState()).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); fetchSpy.mockRestore(); }
});
