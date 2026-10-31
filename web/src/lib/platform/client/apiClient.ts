import { z, type ZodType } from "zod";
import { abortable, throwIfAborted } from "./abort";
import { ApiError } from "./apiError";
import { withRetry, type RetryOptions } from "./retry";
import type { RouteDef } from "./route";

export { ApiError } from "./apiError";

export interface CallOptions<P, Q, B> {
  params?: P;
  query?: Q;
  body?: B;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  retry?: Partial<RetryOptions>;
}

const ErrorEnvelope = z.object({ error: z.object({
  code: z.string(), message: z.string(),
  retryAfterMs: z.number().nonnegative().optional(),
}) });

function parse<T>(schema: ZodType<T> | undefined, value: T | undefined, kind: string): T | undefined {
  if (!schema) return value;
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("validation_error", 0, `Invalid ${kind}`, undefined, { cause: result.error });
  return result.data;
}

function object(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("validation_error", 0, "Params and query must be objects");
  }
  return value as Record<string, unknown>;
}

function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return String(value);
  throw new ApiError("validation_error", 0, "URL values must be strings, booleans or finite numbers");
}

function encodeParam(value: unknown): string {
  try {
    const text = scalar(value);
    if (text === "." || text === ".." || text === "") throw new TypeError("Empty or dot path segment");
    return encodeURIComponent(text);
  } catch (cause) {
    throw new ApiError("validation_error", 0, "Invalid path parameter", undefined, { cause });
  }
}

function urlFor(path: string, params: unknown, query: unknown, baseUrl: string): string {
  const values = object(params);
  const filled = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new ApiError("validation_error", 0, `Missing path parameter: ${key}`);
    return encodeParam(values[key]);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(object(query))) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, scalar(item));
  }
  const suffix = search.size > 0 ? `?${search}` : "";
  return `${baseUrl.replace(/\/$/, "")}${filled}${suffix}`;
}

function serialize(body: unknown): { json: string | undefined; hasNonce: boolean } {
  let json: string | undefined;
  try {
    json = body === undefined ? undefined : JSON.stringify(body);
    if (body !== undefined && json === undefined) throw new TypeError("Not JSON");
  } catch (cause) {
    throw new ApiError("validation_error", 0, "Body must be JSON serializable", undefined, { cause });
  }
  const sent: unknown = json === undefined ? undefined : JSON.parse(json);
  const hasNonce = sent !== null && typeof sent === "object" && "clientNonce" in sent
    && typeof sent.clientNonce === "string" && sent.clientNonce.trim().length > 0;
  return { json, hasNonce };
}

export function createApiClient({ fetch: transport = globalThis.fetch, baseUrl = "", retry = {} }: ApiClientOptions = {}) {
  const retryOptions = { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 4_000, ...retry };
  for (const [name, value] of Object.entries(retryOptions)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  }
  if (!Number.isInteger(retryOptions.maxRetries)) throw new RangeError("maxRetries must be an integer");
  return {
    async call<P, Q, B, R>(route: RouteDef<P, Q, B, R>, options: CallOptions<NoInfer<P>, NoInfer<Q>, NoInfer<B>> = {}): Promise<R> {
      const { signal } = options;
      try {
        throwIfAborted(signal);
        const params = parse(route.params, options.params, "params");
        const query = parse(route.query, options.query, "query");
        const body = parse(route.body, options.body, "body");
        const url = urlFor(route.path, params, query, baseUrl);
        if (route.method === "GET" && body !== undefined) throw new ApiError("validation_error", 0, "GET cannot have a body");
        const { json, hasNonce } = serialize(body);
        const safe = route.idempotent === true || (route.method === "GET" && route.idempotent !== false) || hasNonce;
        return await withRetry(async () => {
          let response: Response;
          try {
            response = await abortable(transport(url, {
              method: route.method, credentials: "same-origin", signal,
              headers: { Accept: "application/json", ...(json === undefined ? {} : { "Content-Type": "application/json" }) },
              body: json,
            }), signal);
          } catch (cause) {
            throwIfAborted(signal);
            if (cause instanceof Error && cause.name === "AbortError") throw cause;
            throw new ApiError("network_error", 0, "Network request failed", undefined, { cause });
          }
          let data: unknown;
          try { data = await abortable(response.json(), signal); }
          catch (cause) {
            throwIfAborted(signal);
            if (response.ok) throw new ApiError("invalid_response", response.status, "Expected a JSON response", undefined, { cause });
          }
          if (!response.ok) {
            const envelope = ErrorEnvelope.safeParse(data);
            if (envelope.success) {
              const { code, message, retryAfterMs } = envelope.data.error;
              throw new ApiError(code, response.status, message, retryAfterMs);
            }
            throw new ApiError("http_error", response.status, `Request failed (${response.status})`);
          }
          const result = route.response.safeParse(data);
          if (!result.success) throw new ApiError("invalid_response", response.status, "Response failed validation", undefined, { cause: result.error });
          return result.data;
        }, safe, retryOptions, signal);
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new ApiError("aborted", 0, "Request aborted", undefined, { cause: error });
        }
        throw error;
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
