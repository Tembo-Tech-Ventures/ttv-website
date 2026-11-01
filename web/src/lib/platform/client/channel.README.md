# Channel client state (S-2.1, S-2.2)

Import from `@/lib/platform/client/channel`, `@/lib/platform/client/channelList`,
`@/lib/platform/client/composer` and their hooks in `@/lib/platform/client/hooks/`.
Nothing is wired into a page in these changes. Production entry points never
import fixtures; UI harnesses import `createChannelMockClient({ viewer?,
latencyMs?, failure? })` from `@/lib/platform/client/channel.mock`. It serves the
fixture scenes and read markers, plus posts (idempotent on the nonce), edits,
deletions and reactions by `viewer`.

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
- `update(messages)`, `peek(id)` and `setOverlay(id, overlay | null)`: the
  optimistic layer the composer uses (below).
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
pages collapse to one entry. For an older page, a cached copy wins while the
window is live (polling keeps it fresh); otherwise the page's copy wins.

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
list. A removed parent (tombstone or 404) sets `thread.status = "removed"` and
announces "This thread is no longer available". A removed thread stays removed,
even if a reply request fails or a thread page arrives afterwards. A failed
thread request sets `status: "error"`. The next successful poll or older-replies
request restores `"ready"`, keeping the loaded replies.

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

## Composer (S-2.2)

`createComposer({ store, me, api?, mock?, storage?, now?, newNonce? }): Composer`,
one per channel view, beside the channel store. `me` is the safe `Me` DTO (only
`user.id` and `flags` are read). Construction does no network, storage or
browser work; the first hook to retain it loads this channel's drafts.

```tsx
const [composer] = useState(() => createComposer({ store, me }));
const [draft, setDraft] = useDraft(composer, threadId);   // null: the channel's own composer
const pending = useOutbox(composer, threadId);            // render after the messages
const mentions = useMentionCandidates(composer, threadId); // { tembo, people }
const conduct = useComposer(composer, state => state.conductRequired);
const busy = useMessageBusy(composer, message.id);         // optional "Saving…"

<textarea value={draft.body} onChange={event => setDraft({ body: event.target.value })} />
<button onClick={() => composer.send({ body: draft.body, parentId: threadId, embeds: draft.embeds }).catch(() => {})}>Send</button>
{pending.map(item => <p key={item.clientNonce}>{item.body} {item.status === "failed" && <>
  {item.failure?.message}
  {item.failure?.retryable && <button onClick={() => void composer.retry(item.clientNonce).catch(() => {})}>Try again</button>}
  <button onClick={() => composer.discard(item.clientNonce)}>Discard</button>
</>}</p>)}
```

The composer satisfies U-2.1's `ChannelActions` (`send`, `edit`, `remove`,
`react`): each resolves once the server has confirmed the change and the store
holds the server's copy, and rejects with the `ApiError` otherwise.

### Drafts

- One draft per channel and per thread (`draftScope(parentId)`), with text and
  `EmbedRef`s. They are kept in **sessionStorage only**, under one key per user and
  channel (`ttv-channel-drafts:<user>:<channel>`), so they end with the tab and are
  bounded: 20 thread drafts per channel, the most recently edited kept.
- Typing is saved 300 ms after it pauses, and on `pagehide` and release. Sending
  empties the draft at once; the text waits in the outbox, saved at once, until the
  server confirms it. Then it is gone. A failed send keeps its text.
- **Sign-out:** call `clearChannelDrafts()` from the sign-out flow, beside
  `clearOnboardingDrafts()`. As a second lock, loading a composer removes every
  other account's channel drafts from the tab.
- `setDraft(parentId, { body?, embeds? })`, `clearDraft(parentId)` and
  `draft(parentId)`.

### Sends

`send({ body, parentId, embeds })` validates with `PostMessage`, adds an outbox
item (`status: "sending"`) with a fresh `clientNonce` and posts it.

- **Confirmed:** the echo is merged with `store.receive` and the item disappears.
  A `FLAGGED` or `HIDDEN` echo is kept, with its moderation state for the author,
  and announced ("Sent. A person will check it…" / "Sent, but hidden…").
- **Lost response:** when polling shows the reader's message with the item's
  nonce, the item is confirmed. Sends restored from storage after a reload start
  as failed (`interrupted`) and are confirmed the same way.
- **Failed:** the item stays with `failure: { reason, message, retryable, retryAt }`
  and the message is announced. `retry(nonce)` sends it again with the **same
  nonce**, so the server stores it once; a retry while it is in flight joins it.
  `discard(nonce)` drops it; `restore(nonce)` puts it back into its empty draft.
  A retry before a rate limit's `retryAt` is refused without a request.
- **No answer:** every write gives up after 20 s (`timeoutMs`) and fails as
  `timeout`, so a stalled connection never leaves an item stuck in `sending`.

| Reason | When | Retryable |
|---|---|---|
| `offline` | The browser is offline (`navigator.onLine`); sends are retried automatically on `online` | yes |
| `unreachable` | The request never reached TTV while the browser is online | yes |
| `timeout` | No answer within `timeoutMs` (the write may still land; a retried send reuses its nonce) | yes |
| `rate_limited` | 429; `retryAt` from `retryAfterMs`. Never retried automatically | yes |
| `conduct_required` | The code of conduct isn't agreed; also sets `conductRequired` | yes |
| `moderation_rejected` | Refused as written; `restore` to change it | no |
| `signed_out` | 401 | yes |
| `forbidden` | 403: can't post here (for example a STAFF channel), or can't change this message | no |
| `unavailable` | 404 or `flag_off` | no |
| `gone` | Edits, deletions, reactions: 404 or 409 | no |
| `invalid` | Other 4xx | no |
| `server`, `interrupted` | 5xx or unknown; restored after a reload | yes |

At most 20 sends wait at once.

### Edits, deletions and reactions

`edit(id, body)`, `remove(id)` and `react(id, kind, active)` show at once through
`setOverlay` and are sent **one at a time per message, in the order made**, so the
server applies them as the reader did. Reactions set, never toggle.

- On success the server's copy replaces the cached one through `store.update`,
  which never adds a message (a confirmation can't bring back one polling removed).
- On failure only that change is undone: the overlay is recomputed from the
  changes still pending, over the cached copy, which polling kept fresh.
- **Stale responses:** a confirmed copy is pinned. A `since` response to a request
  that started before the confirmation does not replace it, because that copy may
  predate the write. It could also follow it, for example someone else's deletion,
  so the store keeps its previous checkpoint and the next poll reads that delta
  again; that answer is applied. Nothing is lost, and with `since` responses the
  confirmed copy never flickers back.
- A latest or thread snapshot that was in flight is applied as it is (no
  checkpoint can be held), and polling from its own checkpoint brings anything it
  predates. Until that next poll, an edit or reaction can show its earlier
  version.
- **Deletions are terminal.** The ids of the reader's confirmed deletions (the 500
  newest) are remembered, cached or not, for example a reply in a thread that was
  closed meanwhile. No server copy, from a snapshot or a poll, shows those messages
  again.

### Mentions

`mentionCandidates(channelId, threadId?)` and `useMentionCandidates(composer,
threadId?)` return `{ tembo, people }`. `tembo` is true only while
`me.flags.tembo_channels` is on. `people` are the authors seen in the open
thread (repliers, then its author) and the channel window, newest first, at most
50, never the reader, Tembo or deleted accounts. There is no members route (B-2.3
has none), so people who haven't posted in view aren't offered yet.

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
5. A repeated `postMessage` with the same author and `clientNonce` returns the
   original message (200; 201 when new), and the author receives `clientNonce` on
   their messages. A used nonce with other content is 409 `conflict`.
6. Refusals use the error envelope: 429 `rate_limited` with `retryAfterMs`,
   `moderation_rejected`, `conduct_required` (403, until the current code of
   conduct is agreed; any other 403 reads as "can't post here" or "can't change
   this message"), and 404/409 for edits of messages that are gone or deleted.
   Deleting again returns the same placeholder (B-2.3 contract, seq 345).

If B-2.3 needs different semantics, the change belongs in `channelWindow.ts` and
`channel.ts`.

Verification: `npx vitest run src/lib/platform/client/channel src/lib/platform/client/composer src/lib/platform/client/hooks/channel src/lib/platform/client/hooks/composer`.
