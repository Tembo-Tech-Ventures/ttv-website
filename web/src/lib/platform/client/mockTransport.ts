import { abortable, delay, throwIfAborted } from "./abort";

export interface MockReply {
  data: unknown;
  status?: number;
}
export interface MockHandler {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Same :param syntax as RouteDef. */
  path: string;
  reply: (context: { request: Request; params: Record<string, string> }) => MockReply | Promise<MockReply>;
}
export interface MockOptions {
  latencyMs?: number;
  /** 1-based request count; return an error to simulate a network failure. */
  failure?: (request: Request, call: number) => MockReply | Error | undefined;
}

/** Explicit injection only; never switches production requests into mock mode. */
export function createMockTransport(handlers: readonly MockHandler[], { latencyMs = 0, failure }: MockOptions = {}): typeof fetch {
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 2_147_483_647) throw new RangeError("Invalid mock latency");
  let calls = 0;
  return async (input, init) => {
    // A fixed origin lets relative API paths work in Node without consulting window.
    const source = typeof input === "string" ? new URL(input, "https://mock.invalid") : input;
    const request = new Request(source, init);
    throwIfAborted(request.signal);
    const call = ++calls;
    if (latencyMs) await delay(latencyMs, request.signal);
    const injected = failure?.(request, call);
    if (injected instanceof Error) throw injected;
    if (injected) return Response.json(injected.data, { status: injected.status ?? 200 });
    const path = new URL(request.url).pathname.split("/");
    for (const handler of handlers) {
      if (handler.method !== request.method) continue;
      const pattern = handler.path.split("/");
      if (pattern.length !== path.length) continue;
      const params: Record<string, string> = {};
      const matches = pattern.every((segment, i) => {
        if (!segment.startsWith(":")) return segment === path[i];
        try { params[segment.slice(1)] = decodeURIComponent(path[i]); }
        catch { return false; }
        return true;
      });
      if (!matches) continue;
      const reply = await abortable(Promise.resolve().then(() => handler.reply({ request, params })), request.signal);
      return Response.json(reply.data, { status: reply.status ?? 200 });
    }
    return Response.json({ error: { code: "mock_not_found", message: "No mock handler matched" } }, { status: 404 });
  };
}
