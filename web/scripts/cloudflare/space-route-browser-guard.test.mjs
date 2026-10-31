import { describe, expect, it, vi } from "vitest";
import { spaceRouteRequest } from "./space-route-browser-guard.mjs";

describe("space route credential containment", () => {
  it.each(["https://foreign.example/path", "http://preview.example/path", "https://user:password@preview.example/path"])("rejects escape target %s before dispatch", async target => {
    const api = { fetch: vi.fn() };
    await expect(spaceRouteRequest(api, "https://preview.example", target)).rejects.toThrow("failed safely");
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it("rejects credentials embedded in the base URL", async () => {
    const api = { fetch: vi.fn() };
    await expect(spaceRouteRequest(api, "https://user:password@preview.example", "/dashboard")).rejects.toThrow("failed safely");
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it.each([301, 302, 303, 307, 308])("returns HTTP%s for inspection with redirects forced off", async status => {
    const response = { status: () => status, headers: () => ({ location: "https://foreign.example" }) };
    const api = { fetch: vi.fn().mockResolvedValue(response) };
    expect(await spaceRouteRequest(api, "https://preview.example", "/dashboard", { maxRedirects: 20 })).toBe(response);
    expect(api.fetch).toHaveBeenCalledExactlyOnceWith("https://preview.example/dashboard", { maxRedirects: 0 });
  });
  it("preserves the canonical form method and body", async () => {
    const api = { fetch: vi.fn().mockResolvedValue({}) };
    const options = { method: "POST", form: { action: "avatar" }, headers: { Origin: "https://preview.example" } };
    await spaceRouteRequest(api, "https://preview.example", "/dashboard/account", options);
    expect(api.fetch).toHaveBeenCalledExactlyOnceWith("https://preview.example/dashboard/account", { ...options, maxRedirects: 0 });
  });
  it("sanitizes real Playwright transport failures without retaining bearer headers or cause", async () => {
    const { request } = await import("@playwright/test");
    const marker = "fictional-space-route-bearer";
    const api = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${marker}` } });
    try {
      const error = await spaceRouteRequest(api, "http://127.0.0.1:1", "/dashboard").catch(value => value);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Space route request failed safely.");
      expect(`${error}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain(marker);
      expect(error.cause).toBeUndefined();
    } finally { await api.dispose(); }
  });
});
