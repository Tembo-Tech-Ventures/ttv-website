import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDemoAction } from "./demo-access-client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("demo action requests", () => {
  it.each([
    ["member-cohort", "/dashboard/community"],
    ["member-noncohort", "/dashboard/community"],
    ["mentor", "/dashboard/mentorship"],
    ["institution", "/dashboard/discover"],
  ] as const)("posts only fixed persona %s and accepts its exact destination", async (persona, redirectTo) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ redirectTo }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestDemoAction(persona)).resolves.toBe(redirectTo);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/demo/switch", expect.objectContaining({ method: "POST", credentials: "same-origin", redirect: "error", body: JSON.stringify({ persona }) }));
  });
  it.each(["https://evil.example", "//evil.example", "/dashboard/community?token=private", "/dashboard/mentorship", null])("rejects unexpected destination %s", async (redirectTo) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ redirectTo })));
    await expect(requestDemoAction("institution")).rejects.toMatchObject({ code: "failed" });
  });
  it.each([[401, "expired"], [403, "forbidden"], [409, "unavailable"], [500, "failed"]])("maps %s safely without retry", async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private server detail", { status: Number(status) }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestDemoAction("mentor")).rejects.toMatchObject({ code, message: "Demo action could not be completed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("posts empty logout and ignores response navigation", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ redirectTo: "https://evil.example" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestDemoAction(null)).resolves.toBe("/demo");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/demo/logout", expect.objectContaining({ body: "{}" }));
  });
  it("aborts a stalled request without retrying", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("aborted"))); }));
    vi.stubGlobal("fetch", fetcher);
    const result = requestDemoAction("mentor").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await result).toMatchObject({ code: "failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
