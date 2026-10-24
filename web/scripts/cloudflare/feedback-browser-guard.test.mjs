import { describe, expect, it, vi } from "vitest";
import { guardFeedbackBrowserContext } from "./feedback-browser-guard.mjs";

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
