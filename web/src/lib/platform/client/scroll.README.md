# Scroll anchoring (S-2.3)

Import `useScrollAnchoring` from `@/lib/platform/client/hooks/scroll`; the
framework-free math is in `@/lib/platform/client/scrollAnchor`. Nothing is wired
into a page in this change. U-2.1's message list and thread rail are the
consumers.

```tsx
const scroller = useRef<HTMLElement>(null);
const { atBottom, scrollToBottom, scrollToItem } = useScrollAnchoring(scroller, {
  items: state.messages,                       // oldest first; each row renders data-message-row={id}
  initialItemId: focusMessageId ?? firstUnread?.id ?? null,
  shouldFollow: appended => appended.some(message => message.author.id === me.user.id),
  onAnchor: store.setAnchor,                   // eviction keeps the page being read
});
// "Jump to latest": await store.jumpToLatest(); scrollToBottom();
// One list per channel: key it by channel id (<MessageList key={channel.id} … />), so a new channel opens fresh.
// Mark read only while atBottom; show "Jump to latest" while !atBottom or !state.live.
<section ref={scroller}>{state.messages.map(m => <li key={m.id} data-message-row={m.id}>…</li>)}</section>
```

## What it does

- **Older messages prepended** (`loadOlder`), or older pages evicted from memory
  above the reader, never move the message being read. The position is measured
  from the first visible items, not from the change in `scrollHeight`, so a
  prepend, an eviction at the top and an append in the same render are all handled.
  If that message is removed (a tombstone), the next of the three remembered
  items holds the place.
- **At the bottom** (within `bottomThresholdPx`, default 100), appended messages
  and growing content (an embed or image loading, observed with `ResizeObserver`)
  keep the reader at the bottom. Away from the bottom, nothing moves the reader,
  except appended items `shouldFollow` accepts (their own message).
- **First render with items and a box** opens at `initialItemId` (its top), or at
  the newest end when it is null or not rendered.
- **A hidden list** (no box: `display: none`, a phone's thread replacing the list)
  is never measured. Its position, `atBottom` and anchor stay as they were, so a
  hidden list never reads as "at the bottom" (and never marks messages read), and
  the reader is put back where they were when it shows again. A list mounted
  hidden opens once it has a box.
- **A scroll whose event hasn't arrived yet** (a commit in the same frame, such as
  `loadOlder` during a fling) is kept, not undone; clamping by shrinking content is
  not mistaken for one.
- **A re-mounted scroll element** is a new surface: listeners move to it and it
  opens afresh.
- `atBottom` drives "Jump to latest" and reading the end of a live channel.
  `onAnchor` reports the first visible item's id, or null at the newest end,
  whenever it changes: exactly what `ChannelStore.setAnchor` takes.
- `scrollToBottom()` jumps now and follows the next render (a fresh page from
  `jumpToLatest()`). `scrollToItem(id, "start" | "center")` scrolls only the
  container, never the page, unlike `scrollIntoView`.

Positions are measured inside the container's border; a sliver of 1px or less of an
item above is not "in view". The container gets `overflow-anchor: none`, so the
browser's own scroll anchoring never adjusts a second time. Jumps are instant, so
following stays exact while messages arrive. Everything runs in effects (layout
effects in the browser only), so it is SSR-safe and never warns on the server.

## Tests

- `npx vitest run src/lib/platform/client/scrollAnchor src/lib/platform/client/hooks/scroll`:
  happy-dom with a small layout model (`scrollGeometry.test-support.ts`). The repo
  runs DOM tests in happy-dom; jsdom is not installed, and adding it would be a new
  dependency.
- `npx playwright test e2e/platform-scroll.spec.ts` against `astro dev`: the
  DEV-only harness `/dev/platform-scroll` (`hooks/scroll.harness.tsx`) checks real
  layout with uneven message heights. In a SAM workspace without Cloudflare
  credentials, start the dev server with remote bindings off; the harness uses
  none.
