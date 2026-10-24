import { describe, expect, it, vi } from "vitest";
import { guardFeedbackBrowserContext, feedbackApiRequest } from "./feedback-browser-guard.mjs";

async function guardedRequest(url, status = 200, redirected = false, failure = false) {
  let handler;
  await guardFeedbackBrowserContext({ route: async (_pattern, callback) => { handler = callback; } }, "https://agent-feedback.example/dashboard");
  const response = { status: () => status };
  const route = {
    request: () => ({ url: () => url, redirectedFrom: () => redirected ? {} : null }),
    abort: vi.fn(),
    fetch: failure ? vi.fn().mockRejectedValue(new Error("sensitive transport details")) : vi.fn().mockResolvedValue(response),
    fulfill: vi.fn(),
  };
  await handler(route);
  return { route, response };
}

describe("feedback bearer browser containment", () => {
  it("aborts transport failures without exposing request call logs", async () => {
    const { route } = await guardedRequest("https://agent-feedback.example/api/feedback", 200, false, true);
    expect(route.abort).toHaveBeenCalledOnce();
    expect(route.fulfill).not.toHaveBeenCalled();
  });
  it("fetches same-origin requests without following redirects", async () => {
    const { route, response } = await guardedRequest("https://agent-feedback.example/api/feedback", 201);
    expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0 });
    expect(route.fulfill).toHaveBeenCalledWith({ response });
    expect(route.abort).not.toHaveBeenCalled();
  });
  it.each([
    ["https://outside.example/api/feedback", false],
    ["http://agent-feedback.example/api/feedback", false],
    ["https://agent-feedback.example/redirected", true],
  ])("blocks %s before forwarding credentials", async (url, redirected) => {
    const { route } = await guardedRequest(url, 200, redirected);
    expect(route.fetch).not.toHaveBeenCalled();
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(route.abort).toHaveBeenCalledOnce();
  });
  it.each([301, 302, 303, 307, 308])("never hands HTTP%s redirects back to the browser", async status => {
    const { route } = await guardedRequest("https://agent-feedback.example/api/feedback", status);
    expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0 });
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(route.abort).toHaveBeenCalledOnce();
  });
});

describe("direct feedback API credential containment", () => {
  it("sanitizes a real Playwright transport failure without retaining its bearer or cause", async () => {
    const { request } = await import("@playwright/test");
    const marker = "fictional-review-bearer-marker";
    const api = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${marker}` } });
    try {
      const error = await feedbackApiRequest(api, "http://127.0.0.1:1", "/unreachable").catch(value => value);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Feedback API request failed safely.");
      expect(`${error}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain(marker);
      expect(error.cause).toBeUndefined();
    } finally { await api.dispose(); }
  });
  it.each(["https://foreign.example/path", "http://preview.example/path", "https://user:password@preview.example/path"])("rejects credential escape target %s before dispatch", async target => {
    const api = { fetch: vi.fn() };
    await expect(feedbackApiRequest(api, "https://preview.example", target)).rejects.toThrow("failed safely");
    expect(api.fetch).not.toHaveBeenCalled();
  });
  it.each(["GET", "POST", "PATCH"])("preserves %s options but always disables redirects", async method => {
    const response = { status: () => 201 };
    const api = { fetch: vi.fn().mockResolvedValue(response) };
    expect(await feedbackApiRequest(api, "https://preview.example", "/api/feedback", { method, data: { fictional: true }, maxRedirects: 20 })).toBe(response);
    expect(api.fetch).toHaveBeenCalledWith("https://preview.example/api/feedback", { method, data: { fictional: true }, maxRedirects: 0 });
  });
  it.each([301, 302, 303, 307, 308])("rejects redirect response %s", async status => {
    const api = { fetch: vi.fn().mockResolvedValue({ status: () => status }) };
    await expect(feedbackApiRequest(api, "https://preview.example", "/api/feedback")).rejects.toThrow("failed safely");
  });
});

// Route-level failures complement the real-browser persistence/redirect tests.
describe("admin save receipt containment", () => {
  async function scenario({ location = "/admin/feedback/fictional?saved=1", status = 303, navigation = true, redirected = false, failure = "", current = "https://preview.example/admin/feedback/fictional" } = {}) {
    const { submitFeedbackAdminSave } = await import("./feedback-browser-guard.mjs");
    const sensitive = new Error("fictional-secret-in-call-log");
    let handler;
    const route = {
      request: () => ({ method: () => "POST", isNavigationRequest: () => navigation, redirectedFrom: () => redirected ? {} : null }),
      fetch: failure === "fetch" ? vi.fn().mockRejectedValue(sensitive) : vi.fn().mockResolvedValue({ status: () => status, headers: () => ({ location, "set-cookie": "must-not-copy" }) }),
      fulfill: vi.fn(), abort: vi.fn(), fallback: vi.fn(),
    };
    const page = {
      url: () => current,
      route: vi.fn(async (_match, callback) => { handler = callback; }),
      unroute: failure === "cleanup" ? vi.fn().mockRejectedValue(sensitive) : vi.fn(),
      goto: failure === "goto" ? vi.fn().mockRejectedValue(sensitive) : vi.fn(),
    };
    const error = await submitFeedbackAdminSave(page, "https://preview.example", async () => {
      if (failure === "submit") throw sensitive;
      await handler(route);
    }).catch(value => value);
    return { error, page, route };
  }
  it.each([302, 303])("accepts only a validated %s receipt without copying upstream data", async status => {
    const { error, page, route } = await scenario({ status, current: "https://preview.example/admin/feedback/fictional?saved=1" });
    expect(error).toBeUndefined();
    expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0 });
    expect(route.fulfill).toHaveBeenCalledWith({ status: 200, contentType: "text/html", body: "<!doctype html><title>Save response</title>" });
    expect(page.goto).toHaveBeenCalledWith("https://preview.example/admin/feedback/fictional?saved=1");
    expect(page.unroute).toHaveBeenCalledOnce();
  });
  it.each([
    "https://foreign.example/admin/feedback/fictional?saved=1",
    "https://user:password@preview.example/admin/feedback/fictional?saved=1",
    "/admin/feedback/other?saved=1", "/admin/feedback/fictional?saved=1&extra=1",
    "/admin/feedback/fictional?saved=1&saved=1", "/admin/feedback/fictional?saved=1#fragment",
    "http://[invalid", "",
  ])("rejects unexpected receipt %s", async location => {
    const { error, page } = await scenario({ location });
    expect(error.message).toContain("failed safely");
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.unroute).toHaveBeenCalledOnce();
  });
  it.each([{ navigation: false }, { redirected: true }])("rejects non-form/redirect-chain requests before fetch: %j", async options => {
    const { error, route, page } = await scenario(options);
    expect(error.message).toContain("failed safely");
    expect(route.fetch).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.unroute).toHaveBeenCalledOnce();
  });
  it.each(["fetch", "submit", "goto", "cleanup"])("sanitizes %s failure and always attempts route cleanup", async failure => {
    const { error, page } = await scenario({ failure });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("failed safely");
    expect(`${error}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain("fictional-secret-in-call-log");
    expect(error.cause).toBeUndefined();
    expect(page.unroute).toHaveBeenCalledOnce();
  });
});
