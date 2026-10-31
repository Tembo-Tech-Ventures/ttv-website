import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./apiError";
import { withRetry } from "./retry";

const options = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 150 };
describe("retry state machine", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("uses jittered exponential backoff, capped, and returns the successful attempt", async () => {
    const op = vi.fn().mockRejectedValueOnce(new ApiError("network_error", 0, "offline"))
      .mockRejectedValueOnce(new ApiError("unavailable", 503, "busy")).mockResolvedValue("ok");
    const result = withRetry(op, true, options);
    await vi.advanceTimersByTimeAsync(49);
    expect(op).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(op).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(74);
    expect(op).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("ok");
  });

  it("honours retryAfterMs as a minimum for 429", async () => {
    const op = vi.fn().mockRejectedValueOnce(new ApiError("rate_limit", 429, "wait", 600)).mockResolvedValue(1);
    const result = withRetry(op, true, { ...options, maxDelayMs: 1_000 });
    await vi.advanceTimersByTimeAsync(599);
    expect(op).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(1);
  });

  it.each(["quota_exhausted", "moderation_rejected", "forbidden"])("never retries terminal %s errors", async code => {
    const error = new ApiError(code, 429, "Cannot continue", 10);
    const op = vi.fn().mockRejectedValue(error);
    await expect(withRetry(op, true, options)).rejects.toBe(error);
    expect(op).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects long cooldowns immediately, preserving the error for UI feedback", async () => {
    const error = new ApiError("rate_limited", 429, "Wait", 151);
    const op = vi.fn().mockRejectedValue(error);
    await expect(withRetry(op, true, options)).rejects.toBe(error);
    expect(op).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("honours a cooldown exactly at the cap", async () => {
    const op = vi.fn().mockRejectedValueOnce(new ApiError("rate_limited", 429, "Wait", 150)).mockResolvedValue(1);
    const result = withRetry(op, true, options);
    await vi.advanceTimersByTimeAsync(149); expect(op).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe(1);
  });

  it.each([
    [new Error("unexpected"), true, 2],
    [new ApiError("busy", 503, "busy"), false, 2],
    [new ApiError("invalid", 400, "invalid"), true, 2],
    [new ApiError("invalid", 600, "invalid"), true, 2],
    [new ApiError("network_error", 403, "invalid"), true, 2],
    [new ApiError("busy", 503, "busy"), true, 0],
  ])("does not retry ineligible errors or exhausted attempts", async (error, safe, maxRetries) => {
    const op = vi.fn().mockRejectedValue(error);
    await expect(withRetry(op, safe, { ...options, maxRetries })).rejects.toBe(error);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("stops after the retry budget", async () => {
    const op = vi.fn().mockRejectedValue(new ApiError("busy", 500, "busy"));
    const result = withRetry(op, true, options).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ status: 500 });
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("aborts before work and during backoff with no further attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const op = vi.fn();
    await expect(withRetry(op, true, options, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(op).not.toHaveBeenCalled();
    const active = new AbortController();
    op.mockRejectedValue(new ApiError("busy", 500, "busy"));
    const result = withRetry(op, true, options, active.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    active.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("does not retry a request cancelled while the operation was running", async () => {
    const controller = new AbortController();
    const op = vi.fn(async () => { controller.abort(); throw new ApiError("busy", 503, "busy"); });
    await expect(withRetry(op, true, options, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(op).toHaveBeenCalledTimes(1);
  });
});
