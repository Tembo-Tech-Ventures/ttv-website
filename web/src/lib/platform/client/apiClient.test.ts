import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, createApiClient } from "./apiClient";
import type { RouteDef } from "./route";

const response = z.object({ count: z.number() });
const read = { method: "GET", path: "/api/channels/:id/messages", params: z.object({ id: z.string() }),
  query: z.object({ cursor: z.string().optional(), limit: z.number().default(5) }), response } satisfies RouteDef<unknown, unknown, unknown, unknown>;
const plain = { method: "GET", path: "/api/count", response } as const;
const post = { ...plain, method: "POST" } as const;
const ok = () => Response.json({ count: 3 });

describe("typed JSON API client", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("encodes path/query, parses defaults, and sends same-origin JSON credentials", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => ok());
    const client = createApiClient({ fetch: transport, baseUrl: "https://example.test/" });
    const data = await client.call(read, { params: { id: "a/b ?" }, query: { cursor: "x &y", limit: 2 } });
    expectTypeOf(data).toEqualTypeOf<{ count: number }>();
    expect(data.count).toBe(3);
    expect(transport).toHaveBeenCalledWith("https://example.test/api/channels/a%2Fb%20%3F/messages?cursor=x+%26y&limit=2",
      expect.objectContaining({ credentials: "same-origin", method: "GET", headers: { Accept: "application/json" } }));
    await client.call(read, { params: { id: "one" }, query: {} as z.infer<typeof read.query> });
    expect(transport.mock.calls[1][0]).toContain("limit=5");
  });

  it.each(["params", "query", "body"])("rejects invalid %s before fetching", async kind => {
    const schema = z.object({ value: z.string() });
    const route = { method: "POST", path: "/api/test", response, [kind]: schema } as RouteDef<unknown, unknown, unknown, { count: number }>;
    const transport = vi.fn<typeof fetch>();
    await expect(createApiClient({ fetch: transport }).call(route, { [kind]: { value: 12 } })).rejects.toMatchObject({ code: "validation_error", status: 0 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("normalizes JSON error envelopes, keeps retry metadata and never retries 403", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "forbidden", message: "No access", retryAfterMs: 1000 } }, { status: 403 }));
    const error = await createApiClient({ fetch: transport }).call(plain).catch(cause => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "forbidden", status: 403, message: "No access", retryAfterMs: 1000 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and 503s, including non-JSON gateway errors", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("gateway down", { status: 503 })).mockResolvedValueOnce(ok());
    const result = createApiClient({ fetch: transport }).call(plain);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ count: 3 });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("honours retryAfterMs from the error envelope", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: "rate_limit", message: "Wait", retryAfterMs: 2000 } }, { status: 429 })).mockResolvedValueOnce(ok());
    const result = createApiClient({ fetch: transport }).call(plain);
    await vi.advanceTimersByTimeAsync(1999);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ count: 3 });
  });

  it.each([
    { code: "quota_exhausted", retryAfterMs: 6 * 60 * 60 * 1000 },
    { code: "quota_exhausted", retryAfterMs: 10 },
    { code: "rate_limited", retryAfterMs: 4001 },
    { code: "moderation_rejected", retryAfterMs: 10 },
    { code: "forbidden", retryAfterMs: 10 },
  ])("immediately surfaces terminal or long cooldown rejection: %j", async error => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: { ...error, message: "Try again later" } }, { status: 429 }));
    await expect(createApiClient({ fetch: transport }).call({ ...post, idempotent: true })).rejects.toMatchObject({ ...error, status: 429 });
    expect(transport).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, {}, { clientNonce: "" }, { clientNonce: 1 }, { clientNonce: " " }])("does not retry unsafe writes: %j", async body => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(createApiClient({ fetch: transport }).call(post, { body })).rejects.toMatchObject({ code: "network_error" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"] as const)("retries nonce-protected %s with identical serialized body", async method => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({}, { status: 500 })).mockResolvedValueOnce(ok());
    const result = createApiClient({ fetch: transport }).call({ ...post, method, body: z.object({ clientNonce: z.string() }) }, { body: { clientNonce: "test-nonce" } });
    await vi.runAllTimersAsync();
    await result;
    expect(transport.mock.calls.map(call => call[1]?.body)).toEqual(['{"clientNonce":"test-nonce"}', '{"clientNonce":"test-nonce"}']);
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("uses the validated body for nonce detection (stripped nonces do not make writes safe)", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 500 }));
    await expect(createApiClient({ fetch: transport }).call({ ...post, body: z.object({ text: z.string() }) },
      { body: { text: "Hello", clientNonce: "stripped" } as { text: string } })).rejects.toMatchObject({ status: 500 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("honours explicit idempotence for writes and opt-out for reads", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok());
    const result = createApiClient({ fetch: transport }).call({ ...post, idempotent: true });
    await vi.runAllTimersAsync();
    await result;
    transport.mockReset().mockRejectedValue(new Error("offline"));
    await expect(createApiClient({ fetch: transport }).call({ ...plain, idempotent: false })).rejects.toMatchObject({ code: "network_error" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([Response.json({ count: "bad" }), new Response("not json")])("rejects malformed responses without retry", async reply => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(reply);
    await expect(createApiClient({ fetch: transport }).call(plain)).rejects.toMatchObject({ code: "invalid_response", status: 200 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("falls back for malformed error envelopes", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { retryAfterMs: -2 } }, { status: 400 }));
    await expect(createApiClient({ fetch: transport }).call(plain)).rejects.toMatchObject({ code: "http_error", status: 400 });
  });

  it("does not retry a transport AbortError even without an external signal", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    await expect(createApiClient({ fetch: transport }).call(plain)).rejects.toMatchObject({ code: "aborted" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("cannot retry based on a nonce omitted from the actual JSON", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(createApiClient({ fetch: transport }).call(post, { body: { clientNonce: "nonce", toJSON: () => ({ text: "hello" }) } })).rejects.toMatchObject({ code: "network_error" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("aborts before fetch, during an uncooperative fetch, response read, and retry wait", async () => {
    const before = new AbortController(); before.abort();
    const transport = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const client = createApiClient({ fetch: transport });
    await expect(client.call(plain, { signal: before.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(transport).not.toHaveBeenCalled();
    const during = new AbortController();
    const pending = client.call(plain, { signal: during.signal }).catch(error => error);
    during.abort(); expect(await pending).toMatchObject({ code: "aborted" });
    const reading = new AbortController();
    const reply = ok(); vi.spyOn(reply, "json").mockImplementation(() => new Promise(() => {}));
    transport.mockResolvedValue(reply);
    const body = client.call(plain, { signal: reading.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); reading.abort(); expect(await body).toMatchObject({ code: "aborted" });
    const waiting = new AbortController();
    transport.mockRejectedValue(new Error("offline"));
    const retry = client.call(plain, { signal: waiting.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); waiting.abort(); expect(await retry).toMatchObject({ code: "aborted" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects unserializable bodies and malformed URL input locally", async () => {
    const transport = vi.fn<typeof fetch>();
    const client = createApiClient({ fetch: transport });
    const circular: { self?: unknown } = {}; circular.self = circular;
    for (const body of [circular, 1n, () => {}, Symbol("invalid")]) await expect(client.call(post, { body })).rejects.toMatchObject({ code: "validation_error" });
    await expect(client.call({ ...plain, path: "/api/:id" })).rejects.toMatchObject({ code: "validation_error" });
    for (const id of [".", "..", "", "\uD800", null]) await expect(client.call({ ...plain, path: "/api/:id" }, { params: { id } })).rejects.toMatchObject({ code: "validation_error" });
    for (const query of [[], null, { nested: {} }, { n: NaN }]) await expect(client.call(plain, { query })).rejects.toMatchObject({ code: "validation_error" });
    await expect(client.call(plain, { body: {} })).rejects.toMatchObject({ code: "validation_error" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("serializes repeated query values and omits null/undefined", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(ok());
    await createApiClient({ fetch: transport }).call(plain, { query: { tag: ["x", "y"], on: true, missing: undefined, empty: null } });
    expect(transport.mock.calls[0][0]).toBe("/api/count?tag=x&tag=y&on=true");
  });

  it.each([{ maxRetries: -1 }, { maxRetries: 0.5 }, { baseDelayMs: NaN }, { maxDelayMs: Infinity }, { maxDelayMs: 2_147_483_648 }])("rejects invalid retry settings", retry => {
    expect(() => createApiClient({ retry })).toThrow(RangeError);
  });
});
