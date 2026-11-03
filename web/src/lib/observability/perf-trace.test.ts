import { describe, expect, it } from "vitest";
import { createSqliteD1 } from "@/test/sqlite-d1";
import { withRoundTrips } from "@/test/d1-round-trips";
import {
  perfComment, perfPhase, perfTraceRequested, sequentialWaves, serverTimingHeader, tracePerf, withPerfTrace,
} from "./perf-trace";

function database() {
  const { database: sqlite, db } = createSqliteD1();
  sqlite.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO item (name) VALUES ('a'), ('b');");
  return { sqlite, db: withRoundTrips(db) };
}

const read = (db: D1Database, id: number) => db.prepare("SELECT name FROM item WHERE id = ?").bind(id).first("name");
const traced = (cookie: string) => new Request("https://preview.example.test/dashboard", { headers: { cookie } });

describe("perfTraceRequested", () => {
  const workers = "Cloudflare-Workers";
  it.each([
    ["production", "ttv-perf=1", workers],
    ["Production", "ttv-perf=1", workers],
    [" prod ", "ttv-perf=detail", workers],
    [undefined, "ttv-perf=1", workers],
    ["agent-pr-9", "other=1", workers],
    ["agent-pr-9", "ttv-perf=1", "Node.js/22"],
  ])("is off for %j with cookie %j on %j", (environment, cookie, userAgent) => {
    expect(perfTraceRequested(environment, traced(cookie), userAgent)).toBe(false);
  });

  it("is on outside production on Workers when the request asks", () => {
    expect(perfTraceRequested("agent-pr-9", traced("a=b; ttv-perf=1"), workers)).toBe(true);
    expect(perfTraceRequested("staging", traced("ttv-perf=detail"), workers)).toBe(true);
  });
});

describe("tracePerf", () => {
  it("counts each round trip once and its depth: parallel reads share one, a dependent read adds one", async () => {
    const { db } = database();
    const { result, summary } = await tracePerf(db, async () => {
      const [a, b] = await Promise.all([read(db, 1), read(db, 2)]);
      const c = await db.prepare("SELECT count(*) AS n FROM item").first("n");
      await db.batch([db.prepare("SELECT 1"), db.prepare("SELECT 2")]);
      return [a, b, c];
    });
    expect(result).toEqual(["a", "b", 2]);
    expect(summary.d1).toBe(4);
    expect(summary.depth).toBe(3);
    const [first, second, third] = summary.queries!;
    expect(first!.statement).toMatch(/^[0-9a-f]{8}$/);
    expect([second!.statement === first!.statement, third!.statement === first!.statement]).toEqual([true, false]);
    expect(summary.queries?.map(({ kind, depth, sql }) => [kind, depth, sql])).toEqual([
      ["first", 1, "SELECT name FROM item WHERE id = ?"],
      ["first", 1, "SELECT name FROM item WHERE id = ?"],
      ["first", 2, "SELECT count(*) AS n FROM item"],
      ["batch", 3, "batch(2)"],
    ]);
  });

  it("records nothing outside a trace and keeps each trace to its own calls", async () => {
    const { db } = database();
    await read(db, 1);
    const [first, second] = await Promise.all([
      tracePerf(db, async () => { await read(db, 1); await read(db, 2); }),
      tracePerf(db, () => read(db, 2)),
    ]);
    expect([first.summary.d1, first.summary.depth]).toEqual([2, 2]);
    expect([second.summary.d1, second.summary.depth]).toEqual([1, 1]);
  });

  it("attributes calls to the innermost phase, and the rest to the page", async () => {
    const { db } = database();
    const { summary } = await tracePerf(db, async () => {
      await perfPhase("auth", () => read(db, 1));
      await perfPhase("space", async () => { await read(db, 1); await perfPhase("admin", () => read(db, 2)); });
      await read(db, 2);
    });
    expect(Object.fromEntries(Object.entries(summary.phases).map(([phase, { d1 }]) => [phase, d1])))
      .toEqual({ auth: 1, space: 1, admin: 1, page: 1 });
  });
});

describe("withPerfTrace", () => {
  it("adds Server-Timing and a trailing comment to an HTML page, without query text unless asked", async () => {
    const { db } = database();
    const response = await withPerfTrace(db, traced("ttv-perf=1"), { cold: true }, async () => {
      await perfPhase("auth", () => read(db, 1));
      return new Response("<html></html>", { headers: { "Content-Type": "text/html", "Content-Length": "13" } });
    });
    expect(response.headers.get("Server-Timing")).toMatch(/^total;dur=[\d.]+, d1;desc="1 queries, 1 waves, depth 1";dur=[\d.]+, cold;desc="true", region;desc="unknown", auth;desc="1 d1";dur=[\d.]+$/);
    expect(response.headers.get("Content-Length")).toBeNull();
    const body = await response.text();
    expect(body.startsWith("<html></html>\n<!--ttv-perf ")).toBe(true);
    const summary = JSON.parse(body.slice(body.indexOf("{"), -3));
    expect(summary).toMatchObject({ cold: true, d1: 1, depth: 1 });
    expect(summary.queries).toBeUndefined();
  });

  it("includes query text for ttv-perf=detail, and decorates redirects and JSON without a comment", async () => {
    const { db } = database();
    const page = await withPerfTrace(db, traced("ttv-perf=detail"), { cold: false }, async () => {
      await read(db, 1);
      return new Response("<p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    });
    expect(await page.text()).toContain("SELECT name FROM item WHERE id = ?");
    const redirect = await withPerfTrace(db, traced("ttv-perf=1"), { cold: false }, async () => Response.redirect("https://example.test/", 302));
    expect([redirect.status, redirect.headers.get("Location")]).toEqual([302, "https://example.test/"]);
    expect(redirect.headers.get("Server-Timing")).toContain("d1;desc=\"0 queries");
    const json = await withPerfTrace(db, traced("ttv-perf=1"), { cold: false }, async () => Response.json({ ok: true }));
    expect(await json.json()).toEqual({ ok: true });
    expect(json.headers.get("Server-Timing")).toBeTruthy();
  });
});

describe("output", () => {
  it("never closes the comment early", () => {
    const comment = perfComment({ cold: false, d1Region: "--> <script>", d1: 0, waves: 0, depth: 0, d1Ms: 0, headersMs: 0, totalMs: 0, phases: {} });
    expect(comment.indexOf("-->")).toBe(comment.length - 3);
    expect(comment).not.toContain("<script>");
    expect(JSON.parse(comment.slice(comment.indexOf("{"), -3)).d1Region).toBe("--> <script>");
  });

  it("keeps the region description a quoted string", () => {
    expect(serverTimingHeader({ cold: false, d1Region: 'W"N\\AM', d1: 0, waves: 0, depth: 0, d1Ms: 0, headersMs: 1, totalMs: 1, phases: {} }))
      .toContain('region;desc="WNAM"');
  });

  it("counts waves by start time as PERF-1 did", () => {
    expect(sequentialWaves([{ at: 0, ms: 10 }, { at: 1, ms: 10 }, { at: 11, ms: 5 }, { at: 12, ms: 5 }, { at: 30, ms: 1 }])).toBe(3);
    expect(sequentialWaves([])).toBe(0);
  });
});
