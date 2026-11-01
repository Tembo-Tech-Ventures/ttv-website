# Channels in the spaces (U-2.3)

The channels' place in the Community and Cohort spaces, behind the `channels`
flag. The domain (tables, who may read and post, the conduct store) is the
backend lane's: `src/lib/channels/README.md`. This module only presents it.

## What is here

- **Sidebars.** `spaceSidebar` (`../platform/spaces/sidebar.ts`) lists a
  space's channels under "Channels" when it is given them: community channels
  (`#`) in Community, the person's cohort channels (a lock) in Cohort, in the
  backend's order. Unread channels are bold with a count; read ones are
  quieter; the open one is current; archived ones say so. Community ends the
  list with "How we talk to each other". Cohort does not, so no sidebar link
  changes space. Direct conversations wait for mentor requests (Phase 4).
  `SpacePage` reads the list through `loadSidebarChannels`, which returns
  nothing (the sidebar exactly as before) while the flag is off, outside
  Community and Cohort, or when the read fails (reported, never fatal).
- **Channel pages** at `/dashboard/{community,cohort}/c/:slug`
  (`resolveChannelPage` in `channel-page.ts`): `ChannelHeader` (name, topic,
  who reads it, who posts), then `ChannelFrame`'s first-visit habits or
  "Conversations aren't open yet". U-2.1's `ChannelView` replaces that note,
  with `ChannelHeader` as its children.
- **"How we talk to each other"**: the words in `conduct.ts` (coordinator
  approved; change them only with the coordinator), shown on a person's first
  channel and at `/dashboard/community/conduct`. Agreeing is a plain form
  (`ConductAgree`, `conduct-flow.ts`) that works without JavaScript and
  returns to the page asked for. Same-origin posts only, and never from an
  agent's delegated session. It grants nothing. Raise `CONDUCT_VERSION`
  (`lib/channels/conduct.ts`) to ask everyone again.
- `server.ts` is the one seam to the backend: `listChannelsFor` and the
  conduct store.

## Tests

- `npx vitest run src/components/channels src/components/platform/spaces`
  (including flag-off parity: every persona's sidebars are identical without
  channels).
- `e2e/platform-channels.spec.ts`: the DEV harness `/dev/platform-channels`
  (`?persona=&space=`, `&channel=<slug>`, `&agreed`, `&view=conduct`,
  `&channels=off`) at 1440 and 390 with axe, no-JS agreeing and personas.
  Then the same journeys on real sessions, set up as in
  `../platform/spaces/README.md`. Locally, the seed resets every persona's
  agreement.

## The conversation (U-2.1)

The conversation inside a channel: the message list, a thread beside it, and
the composer. Designs: Library `/reports/platform-ux-2026-10-30/` screens 01,
02, m1 and m4. Layout rules: `docs/chat-full-page-layout.md`.

### Mounting

`ChannelPageBody.astro` mounts the island on both channel pages
(`/dashboard/{community,cohort}/c/:slug`). Before a person agrees to how we
talk to each other, U-2.3's `ChannelFrame` asks; after, the conversation:

```astro
<ChannelView client:load me={me} channel={channel} initial={first.page.initial}
  initialThread={first.page.thread} initialRead={first.page.read}
  shareables={shareables} threadId={…} messageId={…} now={Date.now()}>
  <div class="channel-view__header"><ChannelHeader channel={channel} /></div>
</ChannelView>
```

- `children` is the frame's header. It sits above the messages, so on a wide
  sheet the thread runs the full height beside both (screens 01 and 02). The
  page passes `fill` to `SpacePage` exactly when the view shows.
- `initial`, `initialThread` and `initialRead` come from B-2.3's
  `getRouteChannelPage`. With them the channel and an open thread read without
  JavaScript, and thread links are real `?thread=` URLs. The page never moves
  the read marker.
- `now` is the server's clock, so day names and times hydrate identically.
  Times are in Africa/Nairobi, as attention's are.
- `shareables` comes from B-2.4's `getRouteChannelShareables`: the person's
  own published projects at their current revision, and, only in their
  cohort's own channels, a clip from each recent session. It is null where
  they cannot post, and then the composer offers no attach tools rather than
  claim there is nothing to share.
- The view creates `createModerationActions` (`moderation-actions.ts`) for
  reports and in-place moderation on B-2.5's routes.
- It renders nothing while `channels` is off for the person. The route 404s
  then (B-2.2); this is the second lock.

### Parts

| File | What it is |
|---|---|
| `ChannelPageBody.astro` | The channel pages' body: the habits first, then the view with server-rendered data |
| `ChannelView.tsx` | Production island: the S-2.1 store and the S-2.2 composer for one channel |
| `ChannelSurface.tsx` | The view itself, given a store and a composer; URL, focus and the live region |
| `MessageList.tsx` | The one scroll surface: day headings, "New", older pages, empty and error states, following, "Jump to latest", read markers |
| `MessageItem.tsx`, `MessageMenu.tsx`, `MessageEdit.tsx` | A message: author, server role badges, time, (edited), deleted, text reactions, thread link; reply, react, edit and delete |
| `MessageBody.tsx` | Words, mentions, inline code and plain links. Never Markdown links or markup |
| `EmbedCard.tsx` | Shared work (U-2.2): a project at the shared revision with one confirmation per mentor and the revision it covers, a session clip at its moment, or "no longer available" with nothing about what it was. "Open" (a new tab) only when the project has its own evidence link. DEV gallery: `/dev/platform-embeds` |
| `MessageModeration.tsx`, `moderation-actions.ts` | Report (anyone but the author), Hide with a reason (the channel's moderators), Restore (admins), and the author's "Ask for review" on a hidden message; the notes that say what happened |
| `TemboAnswer.tsx` | First form of Tembo answers. U-3.1 owns their full design |
| `ThreadRail.tsx` | The thread: beside the list on a wide sheet, in its place on a narrow one |
| `Composer.tsx`, `ComposerParts.tsx`, `mentions.ts` | Writing, on S-2.2's draft (kept for the tab): `@` suggestions, Share project, Session clip (cohort channels only), Ask Tembo (`tembo_channels` only), the code-of-conduct prompt |
| `Outbox.tsx` | The reader's unconfirmed sends after the list or the thread: "Sending…", or why it failed, with Try again (same nonce), Edit and Discard |
| `actions.ts` | `ChannelActions`, what the message list asks of the composer, and embed helpers |
| `channel-format.ts` | Pure rules: days, times, bodies, moderation notices, which tools a channel offers |
| `harness/` | DEV and tests only: fixture pages, a fixture API that behaves like B-2.3 (writes included) and the `/dev/platform-channel` island |

### Rules the view keeps

- **One scroll surface** per column. The document and the sheet never scroll.
  The composer is a flex child, never `position: fixed`.
- **Enter sends only with a fine pointer.** On a touch screen Enter adds a
  line; the send button is always there.
- **New messages are announced once per poll**, politely, from one offscreen
  region. The list is never a live region, and the viewer's own messages are
  not announced. The list follows new messages only when the reader is at the
  end (or sent one); otherwise "Jump to latest" appears.
- **Scrolling is S-2.3's `useScrollAnchoring`** (`client/scroll.README.md`).
  Following the end is instant, never smooth, so it stays exact while
  messages arrive; the arriving row's own rise is the motion. Messages are
  memoised, so the store's frequent publishes (each anchor) redraw only what
  changed.
  The list opens at a linked message or the "New" divider and holds it there,
  however late content above it loads, until the reader moves; older pages
  and evictions never move the message being read; the store hears which
  message is in view (`setAnchor`). `MessageList` is keyed by channel, so a
  new channel opens fresh. The "New" divider skips deleted and hidden
  messages, as the unread count does.
- **"Jump to latest" never covers the end.** While it shows, the list makes
  room for it below the last message; on a narrow sheet it sits at the end
  of the line, clear of reactions and thread links.
- **Role badges come from the server**, worded by the server. Nothing in the
  view infers a role, a trust signal or a confirmation.
- **Moderation is shown to the people the server tells.** `moderation` reaches
  only the author and moderators. A flag says the message stays up until a
  person decides; a hidden message tells its author only they can see it.
  Clef can hide too, so the author's note says "Hidden from the channel",
  not who hid it.
- **Moderating in place** (U-2.2, B-2.5). Everyone but the author can report
  a message, once, with a reason (a choice and their own words); the message
  stays up and the report goes to the admin queue, so the reporter sees
  "You reported this" and nothing else changes. The channel's moderators
  (`canModerate`) hide with a reason the author reads; only admins restore.
  The author of a hidden message can ask for a review once (session-only
  "Review requested" until the server reports it). Each opens as a form
  under its message, takes focus, closes on Escape, and returns focus to the
  message's actions. Nothing is optimistic: a refused step says why and
  changes nothing.
- **Session clip is offered only in cohort channels** that allow it, never in
  community channels or conversations, whatever a capability says.

### Writing

Every change goes through S-2.2's composer (`createComposer`): sends are
optimistic with a client nonce, then wait in the outbox until the server
confirms them; edits, deletions and reactions show at once and roll back
alone if refused. Its failures and moderation outcomes are announced through
the view's one live region. Signing out clears the tab's channel drafts
(`AccountMenu`, beside the onboarding drafts).

### Tests

- `npx vitest run src/components/channels`
- `npx playwright test e2e/platform-channel.spec.ts --project=chromium` against
  `astro dev`. It covers 390 and 1440 px, axe, one scroll surface, the
  keyboard order, focus, the live region, following and "Jump to latest", the
  outbox and retries, the code-of-conduct prompt, drafts across a reload,
  touch Enter, 44px targets and reduced motion. `?persona=`, `?channel=`,
  `?thread=`, `?tembo=off` and `?channels=off` select what the harness shows.
- With the local persona seed and `PLATFORM_PERSONAS_LOCAL_SECRET`
  (`../platform/spaces/README.md`), the same spec makes a message's round trip
  on a real channel page: agree, send, react, read without JavaScript, delete.
