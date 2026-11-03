/**
 * Per-request server trace (PERF-1, PERF-2): every D1 round trip a request makes, the phase that
 * issued it (auth, staging, admin, space, page) and how many of them ran one after another.
 *
 * Opt-in and never in production: the middleware traces a request only outside production, on the
 * Workers runtime, when it carries the `ttv-perf` cookie (perfTraceRequested). A traced response
 * gets `Server-Timing` for the work before its headers, and an HTML page also gets a trailing
 * `<!--ttv-perf {...}-->` comment with the whole trace, including what the page read while it
 * streamed. Query text is added only for `ttv-perf=detail`. The navigation harness in e2e/perf sets
 * the cookie; see web/docs/performance.md.
 *
 * Unit tests call tracePerf around a handler to assert its query count and depth.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type PerfPhase = "auth" | "staging" | "admin" | "space" | "page";

export interface PerfQuery {
  phase: PerfPhase;
  kind: string;
  /** ms from the start of the request. */
  at: number;
  ms: number;
  /** 1 + the deepest query that had finished when this one started: its place in a chain of round trips. */
  depth: number;
  /** The statement's text, shortened; `statement` tells two statements apart when they begin alike. */
  sql: string;
  statement: string;
}

interface PhaseStats { ms: number; d1: number; d1ms: number }

interface Trace {
  start: number;
  headersAt: number | null;
  phases: Partial<Record<PerfPhase, PhaseStats>>;
  queries: PerfQuery[];
  finishedDepth: number;
  /** Where D1 answered this request from, from the first result that says (all, run and batch do). */
  region: string | null;
  cold: boolean;
  detail: boolean;
}

export interface PerfSummary {
  /** The first request this isolate served: module load and cold-start work included. */
  cold: boolean;
  /** Where D1 answered this request from: null when no result carried D1's meta (first and raw do not). */
  d1Region: string | null;
  d1: number;
  /** Queries that started after every earlier one had finished (PERF-1's definition). */
  waves: number;
  /** The longest chain of queries each started after another finished: round trips on the critical path. */
  depth: number;
  d1Ms: number;
  headersMs: number;
  totalMs: number;
  phases: Partial<Record<PerfPhase, PhaseStats>>;
  queries?: PerfQuery[];
}

const traces = new AsyncLocalStorage<Trace>();
const phases = new AsyncLocalStorage<PerfPhase>();
/** Set inside a timed call, so a method that calls another (raw over all) counts once. */
const inCall = new AsyncLocalStorage<true>();
const round = (value: number) => Math.round(value * 10) / 10;

function stats(trace: Trace, phase: PerfPhase): PhaseStats {
  return (trace.phases[phase] ??= { ms: 0, d1: 0, d1ms: 0 });
}

/** D1's own meta, on all(), run() and batch() results: which region and replica answered. */
function regionOf(result: unknown): string | null {
  const meta = (result as { meta?: { served_by_region?: string; served_by_primary?: boolean; served_by?: string } } | null)?.meta;
  if (!meta?.served_by_region && !meta?.served_by) return null;
  return `${meta.served_by_region ?? "?"}${meta.served_by_primary === false ? " (replica)" : ""} ${meta.served_by ?? ""}`.trim();
}

/** FNV-1a over the whole statement: the same SQL text twice in one request is a repeated read. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Times one D1 call into the current trace, if any. */
async function timed<T>(kind: string, sql: string, call: () => Promise<T>): Promise<T> {
  const trace = traces.getStore();
  if (!trace || inCall.getStore()) return call();
  const startedAt = performance.now();
  const depth = trace.finishedDepth + 1;
  try {
    const result = await inCall.run(true, call);
    trace.region ??= regionOf(Array.isArray(result) ? result[0] : result);
    return result;
  } finally {
    const ms = performance.now() - startedAt;
    trace.finishedDepth = Math.max(trace.finishedDepth, depth);
    const phase = phases.getStore() ?? "page";
    const entry = stats(trace, phase);
    entry.d1 += 1;
    entry.d1ms += ms;
    const text = sql.replace(/\s+/g, " ");
    trace.queries.push({ phase, kind, at: round(startedAt - trace.start), ms: round(ms), depth, sql: text.slice(0, 160), statement: fingerprint(text) });
  }
}

const probes = new WeakSet<object>();
const instrumented = new WeakSet<object>();
type Method = (this: unknown, ...args: unknown[]) => unknown;

/** Wraps a statement's own methods: bound statements are wrapped in turn. Wrappers are never wrapped twice. */
function instrumentStatement<S extends object>(statement: S, sql: string): S {
  const target = statement as Record<string, Method>;
  for (const kind of ["first", "all", "run", "raw"]) {
    const original = target[kind];
    if (typeof original !== "function" || probes.has(original)) continue;
    const probe: Method = function (this: unknown, ...args) {
      return timed(kind, sql, () => original.apply(this, args) as Promise<unknown>);
    };
    probes.add(probe);
    target[kind] = probe;
  }
  const bind = target.bind;
  if (typeof bind === "function" && !probes.has(bind)) {
    const probe: Method = function (this: unknown, ...values) {
      return instrumentStatement(bind.apply(this, values) as object, sql);
    };
    probes.add(probe);
    target.bind = probe;
  }
  return statement;
}

/**
 * Counts every caller of this binding (Drizzle, better-auth, raw SQL). Patches the object that owns
 * `prepare` and `batch`: the binding's class on Workers, the object itself for test doubles. Outside a
 * trace the wrappers only pass through.
 */
export function instrumentD1(db: D1Database): void {
  const owner = (Object.hasOwn(db, "prepare") ? db : Object.getPrototypeOf(db)) as Record<string, Method>;
  if (instrumented.has(owner)) return;
  instrumented.add(owner);
  const prepare = owner.prepare;
  owner.prepare = function (this: unknown, sql) {
    return instrumentStatement(prepare.call(this, sql) as object, String(sql));
  };
  const batch = owner.batch;
  owner.batch = function (this: unknown, statements) {
    const list = statements as unknown[];
    return timed("batch", `batch(${list.length})`, () => batch.call(this, list) as Promise<unknown>);
  };
}

function normalizedEnvironment(environment: string | undefined): string {
  return (environment ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

const PERF_COOKIE = /(?:^|;\s*)ttv-perf=([^;]*)/;

/** Outside production, on the Workers runtime, and only when the request asks with the `ttv-perf` cookie. */
export function perfTraceRequested(
  environment: string | undefined,
  request: Request,
  userAgent: string | undefined = globalThis.navigator?.userAgent,
): boolean {
  const name = normalizedEnvironment(environment);
  if (!name || name === "production" || name === "prod") return false;
  return userAgent === "Cloudflare-Workers" && PERF_COOKIE.test(request.headers.get("cookie") ?? "");
}

let isolateServed = false;

/** True for the first request this isolate serves, traced or not: call once per request. */
export function firstRequestOfIsolate(): boolean {
  const first = !isolateServed;
  isolateServed = true;
  return first;
}

function newTrace(detail: boolean, cold: boolean): Trace {
  return { start: performance.now(), headersAt: null, phases: {}, queries: [], finishedDepth: 0, region: null, cold, detail };
}

/** Round trips by start time: a query that starts after every earlier one has finished begins a new wave. */
export function sequentialWaves(queries: readonly Pick<PerfQuery, "at" | "ms">[]): number {
  let waves = 0;
  let busyUntil = -Infinity;
  for (const query of queries.toSorted((a, b) => a.at - b.at)) {
    if (query.at >= busyUntil - 0.5) waves += 1;
    busyUntil = Math.max(busyUntil, query.at + query.ms);
  }
  return waves;
}

function summarize(trace: Trace, end: number): PerfSummary {
  const queries = trace.queries.filter((query) => query.at <= end - trace.start);
  return {
    cold: trace.cold,
    d1Region: trace.region,
    d1: queries.length,
    waves: sequentialWaves(queries),
    depth: queries.reduce((deepest, query) => Math.max(deepest, query.depth), 0),
    d1Ms: round(queries.reduce((sum, query) => sum + query.ms, 0)),
    headersMs: round((trace.headersAt ?? end) - trace.start),
    totalMs: round(end - trace.start),
    phases: Object.fromEntries(Object.entries(trace.phases).map(([name, value]) =>
      [name, { ms: round(value.ms), d1: value.d1, d1ms: round(value.d1ms) }])),
    ...(trace.detail ? { queries } : {}),
  };
}

/** `Server-Timing` for the work done before the headers. */
export function serverTimingHeader(summary: PerfSummary): string {
  return [
    `total;dur=${summary.headersMs}`,
    `d1;desc="${summary.d1} queries, ${summary.waves} waves, depth ${summary.depth}";dur=${summary.d1Ms}`,
    `cold;desc="${summary.cold}"`,
    `region;desc="${(summary.d1Region ?? "unknown").replace(/["\\]/g, "")}"`,
    ...Object.entries(summary.phases).map(([name, value]) => `${name};desc="${value.d1} d1";dur=${value.ms}`),
  ].join(", ");
}

/** The trailing HTML comment: JSON that can never close the comment early. */
export function perfComment(summary: PerfSummary): string {
  return `\n<!--ttv-perf ${JSON.stringify(summary).replaceAll("--", "-\\u002d").replaceAll(">", "\\u003e")}-->`;
}

function decorate(trace: Trace, response: Response): Response {
  const timing = serverTimingHeader(summarize(trace, trace.headersAt ?? performance.now()));
  // Redirects and fetched responses have immutable headers: always answer with a copy.
  const headers = new Headers(response.headers);
  headers.set("Server-Timing", timing);
  const html = headers.get("Content-Type")?.includes("text/html") ?? false;
  if (!response.body || !html) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const encoder = new TextEncoder();
  const tail = new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) {
      controller.enqueue(encoder.encode(perfComment(summarize(trace, performance.now()))));
    },
  });
  headers.delete("Content-Length");
  return new Response(response.body.pipeThrough(tail), { status: response.status, statusText: response.statusText, headers });
}

/** Runs the whole request inside a trace and decorates its response. */
export function withPerfTrace(
  db: D1Database,
  request: Request,
  { cold }: { cold: boolean },
  run: () => Promise<Response>,
): Promise<Response> {
  instrumentD1(db);
  const cookie = PERF_COOKIE.exec(request.headers.get("cookie") ?? "")?.[1] ?? "";
  const trace = newTrace(/\bdetail\b/.test(cookie), cold);
  return traces.run(trace, async () => {
    const response = await run();
    trace.headersAt = performance.now();
    return decorate(trace, response);
  });
}

/** For tests: runs `run` inside a trace of `db` and returns its result with the summary, queries included. */
export async function tracePerf<T>(db: D1Database, run: () => Promise<T>): Promise<{ result: T; summary: PerfSummary }> {
  instrumentD1(db);
  const trace = newTrace(true, false);
  const result = await traces.run(trace, run);
  return { result, summary: summarize(trace, performance.now()) };
}

/** Attributes the D1 work and wall time of `run` to `phase`. Nested phases count toward the innermost. */
export function perfPhase<T>(phase: PerfPhase, run: () => Promise<T>): Promise<T> {
  const trace = traces.getStore();
  if (!trace) return run();
  const startedAt = performance.now();
  return phases.run(phase, async () => {
    try {
      return await run();
    } finally {
      stats(trace, phase).ms += performance.now() - startedAt;
    }
  });
}
