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
- **First render with items** opens at `initialItemId` (its top), or at the newest
  end when it is null or not rendered.
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
