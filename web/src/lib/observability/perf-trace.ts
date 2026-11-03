/**
 * PERF-1 (investigation branch only, never merged): per-request server timing.
 *
 * Counts every D1 round trip a request makes and attributes it, with its wall
 * time, to the phase that issued it (auth, staging, admin, space, page). Phases
 * that finish before the response headers are sent go out as `Server-Timing`;
 * the full trace, including what the page renders while it streams, is appended
 * to HTML bodies as a trailing `<!--ttv-perf {...}-->` comment.
 *
 * Off in production: `perfTraceEnabled` refuses the production environment.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type PerfPhase = "auth" | "staging" | "admin" | "space" | "page";

interface PhaseStats { ms: number; d1: number; d1ms: number; }
interface Trace {
  start: number;
  headersAt: number | null;
  phases: Partial<Record<PerfPhase, PhaseStats>>;
  queries: { phase: PerfPhase; kind: string; at: number; ms: number; sql: string }[];
  /** The first request this isolate served: module load and cold-start work included. */
  cold: boolean;
}

const traces = new AsyncLocalStorage<Trace>();
const phases = new AsyncLocalStorage<PerfPhase>();

function stats(trace: Trace, phase: PerfPhase): PhaseStats {
  return (trace.phases[phase] ??= { ms: 0, d1: 0, d1ms: 0 });
}

function record(kind: string, sql: string, startedAt: number, ms: number) {
  const trace = traces.getStore();
  if (!trace) return;
  const phase = phases.getStore() ?? "page";
  const entry = stats(trace, phase);
  entry.d1 += 1;
  entry.d1ms += ms;
  trace.queries.push({ phase, kind, at: Math.round(startedAt - trace.start), ms: Math.round(ms * 10) / 10, sql: sql.replace(/\s+/g, " ").slice(0, 90) });
}

let installed = false;
let served = 0;
/** Wraps the D1 binding's prototypes once, so every caller (Drizzle, better-auth, raw) is counted. */
function installD1Probe(db: D1Database) {
  if (installed) return;
  installed = true;
  const statement = Object.getPrototypeOf(db.prepare("SELECT 1")) as Record<string, unknown>;
  const statementSql = new WeakMap<object, string>();
  const prepare = Object.getPrototypeOf(db).prepare as (this: D1Database, sql: string) => D1PreparedStatement;
  Object.getPrototypeOf(db).prepare = function (this: D1Database, sql: string) {
    const prepared = prepare.call(this, sql);
    statementSql.set(prepared, sql);
    return prepared;
  };
  const bind = statement.bind as (this: D1PreparedStatement, ...values: unknown[]) => D1PreparedStatement;
  statement.bind = function (this: D1PreparedStatement, ...values: unknown[]) {
    const bound = bind.apply(this, values);
    statementSql.set(bound, statementSql.get(this) ?? "?");
    return bound;
  };
  for (const kind of ["first", "all", "run", "raw"] as const) {
    const original = statement[kind] as (...args: unknown[]) => Promise<unknown>;
    statement[kind] = async function (this: object, ...args: unknown[]) {
      const at = performance.now();
      try { return await original.apply(this, args); }
      finally { record(kind, statementSql.get(this) ?? "?", at, performance.now() - at); }
    };
  }
  const batch = Object.getPrototypeOf(db).batch as (this: D1Database, statements: D1PreparedStatement[]) => Promise<unknown>;
  Object.getPrototypeOf(db).batch = async function (this: D1Database, statements: D1PreparedStatement[]) {
    const at = performance.now();
    try { return await batch.call(this, statements); }
    finally { record("batch", `batch(${statements.length}) ${statementSql.get(statements[0]) ?? ""}`, at, performance.now() - at); }
  };
}

/** Outside production, and only on the Workers runtime: unit tests' fake D1 is never patched. */
export function perfTraceEnabled(environment: string | undefined): boolean {
  return Boolean(environment) && !["production", "prod"].includes(environment!)
    && globalThis.navigator?.userAgent === "Cloudflare-Workers";
}

/** Runs the whole request inside a trace. */
export function withPerfTrace(db: D1Database, run: () => Promise<Response>): Promise<Response> {
  installD1Probe(db);
  const trace: Trace = { start: performance.now(), headersAt: null, phases: {}, queries: [], cold: served++ === 0 };
  return traces.run(trace, async () => {
    const response = await run();
    trace.headersAt = performance.now();
    return finish(trace, response);
  });
}

/** Attributes the D1 work and wall time of `run` to `phase`. Nested phases count toward the innermost. */
export function perfPhase<T>(phase: PerfPhase, run: () => Promise<T>): Promise<T> {
  const trace = traces.getStore();
  if (!trace) return run();
  const at = performance.now();
  return phases.run(phase, async () => {
    try { return await run(); }
    finally { stats(trace, phase).ms += performance.now() - at; }
  });
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Round trips on the critical path: queries that started after every earlier one had finished count as a new wave. */
function sequentialWaves(queries: Trace["queries"]): number {
  let waves = 0;
  let busyUntil = -Infinity;
  for (const query of queries.toSorted((a, b) => a.at - b.at)) {
    if (query.at >= busyUntil - 0.5) waves += 1;
    busyUntil = Math.max(busyUntil, query.at + query.ms);
  }
  return waves;
}

function summary(trace: Trace, end: number) {
  const d1 = trace.queries.length;
  return {
    cold: trace.cold,
    waves: sequentialWaves(trace.queries),
    totalMs: round(end - trace.start),
    headersMs: round((trace.headersAt ?? end) - trace.start),
    d1,
    d1Ms: round(trace.queries.reduce((sum, query) => sum + query.ms, 0)),
    phases: Object.fromEntries(Object.entries(trace.phases).map(([name, value]) => [name, { ms: round(value.ms), d1: value.d1, d1ms: round(value.d1ms) }])),
    queries: trace.queries,
  };
}

function finish(trace: Trace, response: Response): Response {
  const headerSummary = summary(trace, trace.headersAt!);
  const timing = [
    `total;dur=${headerSummary.headersMs}`,
    `d1;desc="${headerSummary.d1} queries, ${headerSummary.waves} waves";dur=${headerSummary.d1Ms}`,
    `cold;desc="${headerSummary.cold}"`,
    ...Object.entries(headerSummary.phases).map(([name, value]) => `${name};desc="${value.d1} d1";dur=${value.ms}`),
  ].join(", ");
  let headers: Headers;
  try {
    response.headers.set("Server-Timing", timing);
    headers = response.headers;
  } catch {
    // Immutable headers (a fetched or redirect response): copy them.
    headers = new Headers(response.headers);
    headers.set("Server-Timing", timing);
    response = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  if (!response.body || !headers.get("Content-Type")?.includes("text/html")) return response;
  // Keep the page's D1 work, issued while it streams, attributed to this trace.
  const encoder = new TextEncoder();
  const tail = new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) {
      controller.enqueue(encoder.encode(`\n<!--ttv-perf ${JSON.stringify(summary(trace, performance.now()))}-->`));
    },
  });
  return new Response(response.body.pipeThrough(tail), { status: response.status, statusText: response.statusText, headers });
}

/**
 * PERF-1 prototypes switched per request, so one preview compares them under the same conditions:
 * the `ttv-perf` cookie holds dot-separated tokens (`mpa`, …). Never in production.
 */
export function perfVariant(environment: string | undefined, request: Request): ReadonlySet<string> {
  if (!perfTraceEnabled(environment)) return new Set();
  const value = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("ttv-perf="));
  return new Set(value ? value.slice("ttv-perf=".length).split(".") : []);
}
