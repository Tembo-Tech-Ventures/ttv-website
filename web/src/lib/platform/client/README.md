# Client-state foundation

Dependency-free primitives using the existing React 18 and Zod installations.
Nothing is wired into pages. Later platform hooks live in `client/hooks/` and
accept an injected API client so the UI lane can use fixtures before APIs land.
Import from `@/lib/platform/client` or individual modules.

## Stores and SSR

```ts
createStore<S>(initial: S): Store<S>
useStore<S, T>(store: Store<S>, selector: (s: S) => T,
  isEqual?: (a: T, b: T) => boolean): T
```

Stores expose `getState`, `getServerSnapshot`, `setState(value | updater)` and
`subscribe(listener)` (returns an unsubscribe function). Updates replace state;
do not mutate it. `Object.is` suppresses unchanged state and is the default
selector comparison. A custom equality function lets a selector return an object
without re-rendering for unrelated updates.

```ts
const store = createStore({ count: 0, loading: false });
store.setState(previous => ({ ...previous, count: previous.count + 1 }));
// Inside a React component:
const count = useStore(store, state => state.count);
```

Create a store per page island or SSR request, never a server module singleton.
Pass the same server-provided initial data to the browser instance. The captured
initial snapshot is used during SSR/hydration, even if the live store has changed.
`useSyncExternalStore` then checks the live snapshot and subscribes. Keep selectors
pure and equality comparisons consistent.

## Typed JSON requests

```ts
const api = createApiClient({ fetch?, baseUrl?, retry? });
await api.call(route, { params?, query?, body?, signal? });
```

`RouteDef<P,Q,B,R>` is re-exported from the shared B-0.1 contract (see `route.ts`).
Zod schemas validate params, query, body and response. Their parsed output (including defaults
and stripped fields) is what gets sent/returned. `call` infers the response type
from the route; options cannot widen the route's types.

```ts
import { z } from "zod";
import { createApiClient } from "@/lib/platform/client";

const route = {
  method: "GET" as const,
  path: "/api/channels/:id/messages",
  params: z.object({ id: z.string() }),
  response: z.object({ messages: z.array(z.object({ id: z.string() })) }),
};
const controller = new AbortController();
const data = await createApiClient().call(route, {
  params: { id: "channel-1" }, signal: controller.signal,
});
// Use ROUTES from ../contracts instead of declaring real routes here.
```

Paths use `:param`; each value is encoded as one path segment. Empty/dot segments
are rejected. Query values are finite numbers, strings, booleans or arrays of
those (repeated keys); null/undefined values are omitted. `baseUrl` is an optional
prefix, for example `https://preview.example`; the default uses relative URLs.
Requests use `credentials: "same-origin"`, JSON bodies and an Accept JSON header.
GET bodies are rejected. Responses must contain parseable JSON, even for writes;
model a successful empty response as JSON `null`, rather than HTTP 204.

`ApiError` exposes `code`, `status`, `message`, `retryAfterMs` and optional `cause`.
Server `{ error: { code, message, retryAfterMs? } }` envelopes retain those values.
Local codes are `validation_error` (status 0), `invalid_response`, `network_error`
(status 0), `http_error` and `aborted` (status 0). Validation failures never fetch;
invalid successful responses never retry. Error bodies without a valid envelope
fall back to `http_error`; non-JSON 5xx gateway responses remain retryable.

Default retry budget: two additional attempts. GET is safe by default; explicit
`idempotent: false` disables that default. Other methods require
`idempotent: true` or a nonblank string `clientNonce` in the **serialized** JSON
body. A route must only opt into idempotence when its handler guarantees it;
nonce handlers must deduplicate server-side. The exact serialized payload is
reused on retry.

Eligible failures: network errors, HTTP 429 and HTTP 500–599. Backoff ceilings
are 250 ms then 500 ms, capped at 4 s; jitter chooses 50–100% of each ceiling.
`retryAfterMs` is a minimum wait within the local cap. A larger server cooldown
is thrown immediately with its retry metadata intact, so the UI can display when
to try again. Terminal `quota_exhausted`, `moderation_rejected` and `forbidden`
codes never retry, regardless of status.
Override with `retry: { maxRetries, baseDelayMs, maxDelayMs }`. Request, response
read and backoff waits all honor `signal`, including an injected transport that
ignores cancellation. Cancellation throws `ApiError` with code `aborted`.

## Visibility-aware polling

```ts
const poller = createPoller({
  run: (signal: AbortSignal) => Promise<{ changed: boolean }>,
  intervalMs: 5_000, maxIntervalMs: 30_000, backoff: 2,
  isActive: () => true,
});
poller.start(); // immediate first run; repeated start is a no-op
poller.refresh(); // re-evaluate activity / request an immediate run
poller.stop(); // abort, clear timer, remove listeners; safe to repeat

// React: same options, plus enabled (default true); returns a stable refresh fn.
const refresh = useVisibilityPolling({ run, intervalMs: 5_000, enabled: true });
```

Each delay starts after the previous run settles, so requests never overlap.
Idle results (`changed: false`) and errors multiply the interval by `backoff`
up to `maxIntervalMs` (defaults: 2 and six times the base interval). Changes,
focus and visibility resume reset the interval. Hidden tabs cancel pending timers
and abort in-flight work. A resumed or restarted poller waits for any old run to
settle, even when it ignores cancellation. A forever-pending callback therefore
blocks further runs; always forward the signal into `api.call`.

The hook updates callbacks without restarting timers, stops on unmount and
preserves no-overlap across configuration changes. Use `enabled` for reactive
on/off state. `isActive` is an additional predicate checked before/after runs and
on focus/visibility/refresh; call the returned `refresh` after changing external
activity governed by that predicate. Polling errors back off; have `run` update
an error store/announcement if the UI should display the failure.

```ts
import type { ApiClient, Store } from "@/lib/platform/client";

const countRoute = {
  method: "GET" as const, path: "/api/count",
  response: z.object({ count: z.number() }),
};

function useMessageCount(api: ApiClient, store: Store<{ count: number }>) {
  useVisibilityPolling({
    intervalMs: 5_000,
    run: async signal => {
      const data = await api.call(countRoute, { signal });
      const changed = data.count !== store.getState().count;
      store.setState(data);
      return { changed };
    },
  });
  return useStore(store, state => state.count);
}
```

## Mock mode for DEV harnesses

```ts
const mockFetch = createMockTransport([
  { method: "GET", path: "/api/count", reply: () => ({ data: { count: 2 } }) },
  {
    method: "GET", path: "/api/channels/:id/messages",
    reply: ({ request, params }) => ({ data: messageFixture }),
  },
], {
  latencyMs: 150,
  failure: (request, call) => call === 1
    ? { status: 503, data: { error: { code: "busy", message: "Try again" } } }
    : undefined,
});
const api = createApiClient({ fetch: mockFetch });
// The same hook works in mock mode:
useMessageCount(api, store);
```

Handlers use colon parameters, decoded into `params`; inspect query/body via
`request`. `reply` can be async, returning `{ data, status? }` (default 200).
Use the shared `../fixtures.ts` data in handlers (for example
`fixtures.communityMessages` for `ROUTES.listMessages`); the inline count above
is only a minimal foundation example. `contracts.test.ts` exercises the real
mentor, message-list, removal-delta and post contracts against these fixtures.
No automatic mode detection or production fallback exists. DEV harnesses must
enforce their own DEV-only route gating.
Mocks support string, URL and Request inputs, init overrides, abortable latency,
and signal cancellation while handlers are pending. Failure injection is
deterministic by 1-based request number: return a reply for an HTTP failure, an
Error for a network failure, or undefined to continue. Unmatched handlers return
a JSON `mock_not_found` 404.

## Accessible announcements

```ts
const announcer = createAnnouncer({ throttleMs: 1_000, dedupeMs: 5_000, maxQueue: 50 });
announcer.announce("3 new messages", "polite", "batch-42");
announcer.announce("Message failed to send", "assertive", "send-failed-42");
// In React:
const announcement = useStore(announcer.store, state => state);
// Render announcement.message as TEXT into the matching aria-live region.
// Use announcement.id as a key so repeated text after expiry is a fresh update.
announcer.clear(); // clear visible text without bypassing throttling
announcer.dispose(); // cancel queue/timer and clear state on owner unmount
```

The UI owns two persistent, initially empty live regions, one `polite`, one
`assertive`, with `aria-atomic="true"`; populate only the matching region. Do not
insert announcement strings as HTML. The first announcement publishes immediately;
subsequent entries publish at most once per throttle interval. Assertive entries
precede pending polite entries, preserving FIFO order within each priority.
Deduplication uses the supplied key, or priority plus text, for `dedupeMs`.
Both pending entries and remembered keys are bounded by `maxQueue`: overflow
drops the last pending entry (lowest priority/latest) and evicts the oldest key.
An immediately dropped announcement returns false. Dropped entries release
their own deduplication keys so they can be retried before the dedupe window ends.
For message bursts, announce a batch count instead of every individual message.

## Verification

From `web/`: `npx vitest run src/lib/platform/client`, `npm run lint`,
`npm run typecheck`. Tests include Node-only imports, SSR snapshots, React
selector equality/lifecycle, fake timers, slow/aborted work, retry eligibility,
visibility, latency/failure injection and bounded announcements. They use the
already installed happy-dom test environment; no dependency files change.

Coverage (with matching Vitest coverage-v8 installed in the test runner):

```sh
npx vitest run src/lib/platform/client --coverage \
  --coverage.include=src/lib/platform/client/poller.ts \
  --coverage.include=src/lib/platform/client/retry.ts
```

This foundation does not implement domain caches, optimistic mutations, cursor
reconciliation or keyboard reducers; those belong to the later state-lane tasks.
