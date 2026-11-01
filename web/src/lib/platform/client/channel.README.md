# Channel client state (S-2.1)

Import from `@/lib/platform/client/channel`, `@/lib/platform/client/channelList`
and `@/lib/platform/client/hooks/channel`. Nothing is wired into a page in this
change. Production entry points never import fixtures; UI harnesses import
`createChannelMockClient` from `@/lib/platform/client/channel.mock`.

```tsx
function ChannelView({ me, channel, initial }: { me: Me; channel: Channel; initial?: MessageList }) {
  const [list] = useState(() => createChannelListStore({ enabled: me.flags.channels }));
  const [store] = useState(() => createChannelStore({
    channelId: channel.id, enabled: me.flags.channels, viewerId: me.user.id, initial,
    initialRead: { lastReadMessageId: null, unreadCount: channel.unreadCount },
    onRead: list.applyRead,
    // mock: createChannelMockClient(), // DEV harness only
  }));
  useChannelFeed(store); // mount once per channel view
  const state = useChannel(store);
  const firstUnread = useChannel(store, selectFirstUnread);
  const badge = useSpaceChannelUnread(list, "community");
  return <>
    {state.hasOlder && <button onClick={() => void store.loadOlder()}>Older messages</button>}
    {state.messages.map(message => <article key={message.id}>
      {message.id === firstUnread?.id && <hr aria-label="New messages" />}
      {message.body}
      <button onClick={() => void store.openThread(message.id)}>Replies</button>
    </article>)}
    {!state.live && state.status === "ready" && <button onClick={() => void store.jumpToLatest()}>Jump to latest</button>}
    {state.read.error && <button onClick={() => void store.retryRead()}>Retry</button>}
    <span aria-live="polite" aria-atomic="true">{state.announcement}</span>
  </>;
}
```

## Channel store

`createChannelStore(options: ChannelOptions): ChannelStore`, one per open channel
view. Options: `channelId`, `enabled` (supply `Me.flags.channels`; default false
means no requests), `api` or `mock`, `initial` (the server's latest page, used for
SSR and hydration), `initialRead`, `viewerId` (own messages are not announced),
`maxMessages` (default 600), `maxThreadMessages` (default 500), `pageSize`
(default 50) and `onRead`.

State (`ChannelState`): `status` (`idle | loading | ready | error`), `messages`
(retained root messages, oldest first), `hasOlder`, `olderTrimmed`, `loadingOlder`,
`olderError`, `live`, `error`, `terminal`, `anchorId`, `thread`, `read` and
`announcement`.

Actions:

- `loadOlder(): Promise<void>`: the page before the oldest retained message.
- `jumpToLatest(): Promise<boolean>`: replace the window with a fresh latest page.
- `setAnchor(id | null)`: the message at the reader's viewport (S-2.3 reports it).
  Null means the newest end.
- `openThread(parentId): Promise<boolean>`, `closeThread()`, `loadOlderReplies()`.
- `markRead(messageId): Promise<boolean>` and `retryRead()`.
- `receive(messages)`: merge server-confirmed messages (S-2.2's post responses)
  without moving cursors.
- `restart()` after a terminal error; `clearAnnouncement()`.
- `poll(signal)`, `isPollActive()` and `retain()` are lifecycle plumbing used by the
  hooks.

Selectors: `selectFirstUnread` (the "New" divider), `selectUnreadCount`,
`selectPollable`.

## Hooks

- `useChannelFeed(store, { enabled? }): () => void` mounts polling through the
  shared `useVisibilityPolling`. **Mount it once per channel view.** The first run
  loads the latest page (or polls since the hydrated page). Then `since` is polled
  every 5 s while the tab is visible, backing off ×2 to 30 s while nothing changes.
  Nothing runs while the tab is hidden; visibility and focus poll immediately.
  Runs never overlap. The returned function polls now. The poller goes quiet when
  nothing is live and wakes when `selectPollable` turns true again. Hiding the tab
  aborts the poll's own requests. A poll that joins a `jumpToLatest()` the reader
  started waits for it, without cancelling it.
- `useChannel(store, selector?, isEqual?)` reads state and keeps the store alive.
  The last released hook aborts all requests.
- `useChannelList(list, selector?, isEqual?)`, `useChannelUnread(list, channelId)`,
  `useSpaceChannelUnread(list, space)` and `useSpaceChannels(list, space)`.

## Channel list and unread badges

`createChannelListStore({ enabled, api?, mock?, initial? })` holds
`GET /api/channels` for the signed-in user. Its hooks share one 30 s poll (backing
off to 120 s, paused while hidden) by reference counting, like the attention
store. With `initial`, the first poll waits one interval. `refresh(signal?)`
resolves whether counts changed and rejects on failure. `applyRead(read)` takes
confirmed read markers from channel stores; a list response requested before a
read cannot bring that channel's old count back.

Selectors: `selectChannelUnread(id)`, `selectSpaceChannelUnread(space)`,
`selectChannelUnreadTotal`, `selectSpaceChannels(space)` and `channelSpace(channel)`.
Cohort channels count towards **Cohort**. Community channels and direct
conversations count towards **Community**. Channel unread is separate from attention
counts (S-1.1); badges that show both add them in the UI.

## Cache, paging and memory

Messages are normalised by id in one entity map shared by the channel window and
the open thread. Entities nothing references are dropped. Lists are ordered by
`createdAt`, then id, whatever order a page arrives in. Duplicates within or across
pages collapse to one entry; for an older page, the cached copy (kept fresh by
polling) wins.

The window is a list of server pages, each keeping its own `beforeCursor`.

- **Polling** (`since`) applies edits and deletions to cached messages, evicts
  `removedIds` from the window and the thread, and appends new root messages. A
  delta that would overfill the newest page becomes its own page when it carries a
  `beforeCursor`; otherwise it joins the newest page.
- **Gaps.** A polled message older than the oldest retained one, while older
  history is unloaded, is ignored, so the window never has a hole. `loadOlder`
  fetches it in order later.
- **Out-of-order responses.** Every response is applied only if its cursor is
  still the window's current edge and no reset (jump to latest, release) happened
  since. Late responses are discarded. Requests never overlap per lane.
- **Memory.** Past `maxMessages` the store drops whole pages from the end farther
  from the anchor page. The anchor page always stays.
  - Dropping older pages keeps a cursor back to them.
  - Dropping newer pages sets `live: false` and stops polling; the UI offers
    "Jump to latest".
  - If one page alone exceeds the limit, it is trimmed around the anchor and
    `olderTrimmed` is set (older history is reachable again through `jumpToLatest`).

  Without an anchor, `loadOlder` keeps the top of the window, where the reader is.
  The open thread is bounded by `maxThreadMessages`.

## Thread pane

One thread is open at a time. Opening another, closing the pane or releasing the
store aborts its requests, and late responses are ignored. A loaded pane survives a
terminal error and `restart()`, or a release followed by a new `retain()`, and
resumes polling. Each poll checks the channel and the open thread together.
Replies are routed by `parentId`, so a channel delta never puts a reply in the root
list. A removed parent (tombstone or 404) sets `thread.status = "removed"`.

## Read markers

`markRead(id)` advances the marker to a cached message of this channel. Read
markers are monotonic:

- a target at or before the current (or pending) marker is a no-op;
- bursts coalesce, so one request is in flight and only the newest waiting target
  is sent next;
- a response reporting an older marker than the confirmed one is ignored;
- a marker id the client hasn't cached is taken to be at least as new as the one
  sent, because the server never rewinds.

`read.markerId` moves at once. `read.unreadCount` drops to 0 at once only when the
newest message of a live window is read. On failure both roll back to server
truth, `read.error` is set and `retryRead()` sends the newest target again.
Confirmed reads go to `onRead`.

## Errors

- **401, 403, 404 and `flag_off`** stop all requests (`terminal`) until `restart()`.
  For a thread, a 404 means the thread is gone, not the channel.
- **An expired or unknown cursor** (HTTP 410, or 400 `validation` on a `since`
  request) is replaced by a fresh latest snapshot.
- **Other failures** keep the data, set `error` and an announcement, and the poller
  backs off.

## Assumptions for B-2.3

The store relies on the wire rules in `src/lib/platform/README.md` and on these
readings of them:

1. `since` is contiguous. It returns the changes after the checkpoint, oldest
   first, and `sinceCursor` checkpoints exactly what was returned. A capped delta
   continues on the next poll.
2. A non-empty page's non-null `beforeCursor` reaches the messages older than that
   page's first item. This holds for latest, `before` and `since` pages.
3. The channel feed (no `thread`) carries root messages and updates to them; a
   thread feed carries that thread's replies. Replies elsewhere are ignored.
4. An expired cursor answers 410 (or 400 `validation`).

If B-2.3 needs different semantics, the change belongs in `channelWindow.ts` and
`channel.ts`.

Verification: `npx vitest run src/lib/platform/client/channel src/lib/platform/client/hooks/channel`.
