# Measuring navigation performance

Spaces and admin pages are server-rendered on every click, so most of a click's time is spent in the
Worker waiting on D1. Each sequential D1 round trip costs the trip from the visitor's colo to the
database. Two tools measure this. Neither ever runs in production.

## The server trace

`src/lib/observability/perf-trace.ts` counts every D1 call a request makes (Drizzle, better-auth and
raw SQL) and attributes it to a phase: `auth`, `staging`, `admin`, `space` (getSpaceContext) or
`page`.

It traces a request only when all of these hold:
- the deployment is not production (`DEPLOYMENT_ENVIRONMENT` is not `production` or `prod`);
- the code runs on the Workers runtime;
- the request carries the `ttv-perf` cookie.

A traced response gets:
- `Server-Timing` for the work done before its headers: total, D1 queries, waves and depth, the D1
  region, and each phase;
- on an HTML page, a trailing `<!--ttv-perf {...}-->` comment with the whole trace, including what
  the page read while it streamed. `ttv-perf=detail` adds each query's SQL text (never its
  parameters).

The trace reports two round-trip counts:
- **waves** (PERF-1's definition): queries that started after every earlier query had finished;
- **depth**: the longest chain of queries where each started after another had finished. It is the
  number of round trips on the critical path, and does not depend on timing.

Unit tests use `tracePerf(db, run)` with `withRoundTrips` (`src/test/d1-round-trips.ts`) to assert a
handler's query count and depth.

## The navigation harness

`e2e/perf/navigation.perf.ts` signs in the preview personas and runs two journeys:
- student: Overview → cohort channel → thread → Community → mentors → Cohort tab → Ask → account →
  account form POST;
- staff: admin → users → user → applications → application → status POST. The status POST is
  stale-guarded, so it writes nothing.

It runs each journey `PERF_REPS` times (3 in CI) at the runner's own speed (`fast`) and throttled
(`throttled`: Slow 4G with a 4× slower CPU). For each step it records:
- click → visible and click → shell hydrated;
- TTFB, FCP and LCP;
- JS files and bytes, and main-thread script time;
- the server trace.

The results go to `test-results/perf/*.json`.

To run it on a pull request's `agent-pr-<n>` preview, label the PR `perf` and push. The preview job
then runs the harness after the e2e suite, which adds about 4 minutes. It writes the summary to the
job summary, and the JSON is in the run's evidence artifact.

To summarise or compare runs:

```bash
cd web
node scripts/perf/summarize.mjs test-results/perf              # median (p75) per step
node scripts/perf/summarize.mjs after/ before/                 # "before → after" per step
```

The runner is in the US, near the preview's D1, so its numbers are a best case for latency. A
visitor in Kenya pays roughly 200–300 ms more per wave. That figure is an estimate (PERF-1 measured
170–320 ms per round trip from Frankfurt), so label any extrapolation as estimated.
