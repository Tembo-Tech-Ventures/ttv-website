# Attention state API (S-1.1)

Import `createAttentionStore`, `useAttention`, `useAttentionCount`,
`useAttentionBadge`, `selectAttentionCount`, `selectAttentionBadge` and types
from `@/lib/platform/client/attention`. Hooks are also exported from
`@/lib/platform/client/hooks/attention`. No shared barrel change is required.

Create one store per signed-in user/request. Keep its identity stable across
React renders. Replace the store when the user or effective spaces flag changes;
release the previous instance. Nothing is connected to a page in this change.

```tsx
function AttentionPanel({ me }: { me: Me }) {
  const [attention] = useState(() => createAttentionStore({
    enabled: me.flags.spaces,
    initialCounts: { count: Object.values(me.unreadCounts).reduce((a, b) => a + b, 0),
      unreadCounts: me.unreadCounts },
    // initialList: serverAttention, // must match the initial filter
    // mock: createAttentionMockClient(), // DEV harness import from client/attention.mock
  }));
  const state = useAttention(attention);
  const total = useAttentionCount(attention);
  const cohortBadge = useAttentionBadge(attention, "cohort");
  useEffect(() => { void attention.refresh(); }, [attention]);
  return <>
    <span>{total}</span>
    <span>{cohortBadge}</span>
    {state.items.map(item => <button key={item.id}
      onClick={() => void attention.markRead({ ids: [item.id] })}>{item.summary}</button>)}
    <button disabled={state.loading || !state.nextCursor}
      onClick={() => void attention.loadMore()}>Older items</button>
    {state.listError && <button onClick={() => void (state.loaded
      ? attention.loadMore() : attention.refresh())}>Retry loading items</button>}
    {state.truncated && <p>Showing the latest attention items.</p>}
    {state.failed.map(failure => <button key={failure.id}
      onClick={() => void attention.retry(failure.id)}>Retry mark read</button>)}
    <span aria-live="polite" aria-atomic="true">{state.announcement}</span>
  </>;
}
```

Signatures:

- `createAttentionStore(options?: AttentionOptions): AttentionStore`
- `useAttention<T = AttentionState>(store, selector?, isEqual?): T`
- `useAttentionCount(store): number`
- `useAttentionBadge(store, space: SpaceId): number`
- Store `refresh(): Promise<void>` replaces the first page; `loadMore()` appends.
- Store `setFilter(filter: AttentionFilter): Promise<void>` resets the list and
  loads that filter. Query filtering is server-owned; clients send the contract value.
- Store `markRead(body: MarkAttentionRead): Promise<boolean>` accepts `{ids}` or
  `{through}`. For mark-all use `state.snapshotAt` from the list, never `Date.now()` (this marks all kinds across filters; offer on `all` or label it accordingly):
  `if (snapshotAt !== null) void attention.markRead({through: snapshotAt})`.
- Store `retry(failureId): Promise<boolean>` and `dismissFailure(failureId): void`.
- Store `refreshCounts(signal?: AbortSignal): Promise<boolean>` reports whether
  counts changed and rejects on request failure; catch it for manual refreshes.
- Store `retain(): () => void`, `start(): void`, `stop(): void` for effect/non-React
  lifecycle ownership. Hooks retain automatically; the last hook stops all work.
  Non-React owners call start/stop. Do not manually stop a store retained elsewhere.
- Standard `getState`, `getServerSnapshot`, `subscribe` and `setState` come from
  `createStore`; consumers should use domain actions for writes.

`enabled` defaults to false: no polling, list or mutation requests. Supply the
effective `spaces` flag; it is a client activity gate, never authorization.
The API owns auth and OFF→404. A 401/403/404 or invalid response becomes an
observable error; mock mode is never selected on failure. This module installs
no endpoints, changes no production surface and flips no flags.

Counts are unread attention items, independent of channel unread. All six space
keys are always present. Counts poll immediately on retain/start without hydrated counts. With `initialCounts`, the first poll waits 30s; focus/visibility still refresh immediately. Later polls run at 30s
when changing, backing off on unchanged/transient-error results up to 180s. Hidden tabs
abort count work and pause timers; visibility/focus refreshes immediately.
Manual count requests share the current flight. Pending mutations pause count
fetches without increasing the idle backoff. Version guards discard stale count responses. HTTP 401/403/404 and `flag_off` stop automatic polling until explicit `start()` or `refreshCounts()` resumes it; errors remain visible.

Mark-read applies immediately to cached items. Requests run serially to preserve
ordering because count responses have no version. Each known unread item is
subtracted once across overlapping mutations. Through-snapshot optimism touches
only cached matching items; uncached counts wait for server truth. Successful
responses replace counts exactly, including unread items outside the cache;
remaining overlays apply on top. Item `readAt` is a local acknowledgement marker
(the response contains counts, not a server read timestamp). Failed writes remove
only their own overlay, preserve concurrent work, and expose a bounded retry entry.
The contract declares this desired-state write idempotent, so the shared client's
bounded retry policy applies. Do not change that policy locally.

Pages normalize/deduplicate by opaque ID, sort by descending creation time then
ID, and retain at most `maxItems` (default 500, allowed 1–10000) newest items.
At capacity, pagination stops and `state.truncated` reports that more history exists beyond this bounded recent feed.
Refresh replaces the window and snapshot; older pages preserve the first-page snapshot. Pages invalidated by concurrent writes retry the same cursor up to two times; further churn exposes a `stale_page` error with explicit refresh/loadMore retry. Failed pages keep the previous cursor
for retry; repeated next cursors terminate pagination. Filter changes abort old
pages. Read acknowledgements retained in the window are monotonic, so overlapping
pages cannot resurrect them. IDs/cursors are passed raw to the shared API client,
which performs URL encoding. Stop aborts reads/writes, cancels queued writes,
removes optimistic overlays and invalidates old responses. Restart reconciles
counts. Failures keep at most 20 entries and queued writes at most 100; capacity
returns false without issuing another write. Constructing a store performs no
network/timer/browser work and initial data is used for SSR/hydration.

Verification: `npx vitest run src/lib/platform/client/attention src/lib/platform/client/hooks/attention`.
Includes fake timers, hidden/focus, abort/restart/StrictMode, stale reads, pagination,
bounded caches, overlapping optimistic rollback, snapshot arrivals, authoritative
reconciliation, authentication failures, invalid contracts and isolated fixtures.

Production `attention` and hook entry points never import fixtures or mock transport.
For UI development only, import `createAttentionMockClient` from
`@/lib/platform/client/attention.mock` and pass `mock: createAttentionMockClient()`
(or `api: createAttentionMockClient()`). The boolean `mock: true` is deliberately
unsupported. Each fixture client is isolated; production does not auto-select it.
