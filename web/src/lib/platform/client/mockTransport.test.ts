import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApiClient } from "./apiClient";
import { createMockTransport, type MockHandler } from "./mockTransport";

const handlers: MockHandler[] = [{ method: "GET", path: "/api/people/:id", reply: ({ params, request }) => ({
  data: { id: params.id, name: "Wanjiku Mwangi", cursor: new URL(request.url).searchParams.get("cursor") },
}) }];
afterEach(() => vi.useRealTimers());

describe("mock transport", () => {
  it("is fetch-compatible with strings, URL, Request, init and async handlers", async () => {
    const transport = createMockTransport([...handlers, { method: "POST", path: "/api/people", reply: async ({ request }) => ({ data: await request.json(), status: 201 }) }]);
    const expected = { id: "x/y", name: "Wanjiku Mwangi", cursor: "next" };
    for (const input of ["/api/people/x%2Fy?cursor=next", new URL("https://mock.invalid/api/people/x%2Fy?cursor=next"), new Request("https://mock.invalid/api/people/x%2Fy?cursor=next")]) {
      expect(await (await transport(input)).json()).toEqual(expected);
    }
    const response = await transport("/api/people", { method: "POST", body: '{"name":"Amina"}' });
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ name: "Amina" });
  });

  it("returns JSON 404 for method, segment, or path-length mismatches", async () => {
    const transport = createMockTransport(handlers);
    for (const [url, method] of [["/api/people/1", "DELETE"], ["/else/people/1", "GET"], ["/api/people", "GET"], ["/api/people/%E0%A4%A", "GET"]]) {
      const response = await transport(url, { method }); expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "mock_not_found" } });
    }
  });

  it("injects latency, a server error and a network failure deterministically", async () => {
    vi.useFakeTimers();
    const transport = createMockTransport(handlers, { latencyMs: 100, failure: (_request, call) => {
      if (call === 1) return { data: { error: { code: "busy", message: "Busy" } }, status: 503 };
      if (call === 2) return new TypeError("offline");
    } });
    const first = transport("/api/people/one"); let settled = false; void first.then(() => { settled = true; return undefined; });
    await vi.advanceTimersByTimeAsync(99); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect((await first).status).toBe(503);
    const second = transport("/api/people/one").catch(error => error); await vi.advanceTimersByTimeAsync(100); expect(await second).toMatchObject({ message: "offline" });
    const third = transport("/api/people/one"); await vi.advanceTimersByTimeAsync(100); expect((await third).status).toBe(200);
    expect((await createMockTransport([], { failure: () => ({ data: "injected" }) })("/any")).status).toBe(200);
  });

  it("aborts latency, pre-aborted requests and handlers that ignore cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const transport = createMockTransport(handlers, { latencyMs: 500 });
    const result = transport("/api/people/1", { signal: controller.signal }).catch(error => error);
    controller.abort(); expect(await result).toMatchObject({ name: "AbortError" }); expect(vi.getTimerCount()).toBe(0);
    await expect(transport("/api/people/1", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    const next = new AbortController();
    const slow = createMockTransport([{ method: "GET", path: "/slow", reply: () => new Promise(() => {}) }]);
    const pending = slow("/slow", { signal: next.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); next.abort(); expect(await pending).toMatchObject({ name: "AbortError" });
  });

  it("runs through the validating API client", async () => {
    const client = createApiClient({ fetch: createMockTransport(handlers) });
    const result = await client.call({ method: "GET", path: "/api/people/:id", params: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }) }, { params: { id: "synthetic-1" } });
    expect(result).toEqual({ id: "synthetic-1", name: "Wanjiku Mwangi" });
  });

  it.each([-1, NaN, Infinity, 2_147_483_648])("rejects invalid latency %s", latencyMs => {
    expect(() => createMockTransport([], { latencyMs })).toThrow(RangeError);
  });
});
