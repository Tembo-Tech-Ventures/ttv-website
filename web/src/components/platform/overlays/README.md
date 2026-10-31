# Attention and search overlays (U-1.3)

Search everything (Ctrl K / ⌘ K) and the attention inbox: a panel hanging from
the bell on wide screens, and `/dashboard/attention` on phones (or for anyone
who follows the link). Dark until the `spaces` flag is on for the person.

## Using them from a space page (U-1.2)

```astro
<SpacesLayout me={me} space="community" title="What's new" overlays={["search", "attention"]}>
  …the page…
  <PlatformOverlays slot="overlays" client:load me={me} />
</SpacesLayout>
```

Only `Me` reaches the island. The attention page owns its own inbox, so it
mounts `<PlatformOverlays attention={false} />` and handles the bell itself.

## What lives where

- `attention/`: the inbox (`AttentionInbox`, rows, filters, failures), the
  panel, the page, `attention-page-data.ts` (the page's frontmatter logic:
  404 on denial, the first page read on the server for no-JS) and
  `attention-client.ts` (the one store and announcer per page, live counts to
  the shell, mark-read and load actions that say what happened).
- `search/`: the overlay, display helpers, per-person recent searches (cleared
  on sign-out from the shell's account menu) and the Ask Tembo hand-off.
- `overlays/`: the integration island, the modal-dialog hook (inert page, Tab
  cycle, Escape, backdrop click, focus back to the trigger), live regions and
  the DEV harness clients.

## Behaviour worth knowing

- One attention store per page: polled every 30 s while visible (S-1.1), first
  poll deferred because `Me` already carries counts. Its owner publishes counts
  to the shell's bell and tabs. Items in spaces the person lacks are never
  shown; application decisions never show who decided.
- Opening an item marks it read, waits up to 1.2 s for the server, then follows
  the link. Failed marks roll back and stay as "Try again / Dismiss" notes.
  Mark all read uses the list's snapshot and is offered only on All.
- Announcements come from one announcer per overlay, keyed per event, so the
  same words are read again when the same thing happens again and nothing is
  read twice. "N new attention items" comes only from count polls.
- Errors are named, never shown as an empty inbox: signed out (401), not
  available (404/403: flag off or no session), failed (retry), and a load
  invalidated by concurrent marks (explicit retry, S-1.1's `stale_page`). A
  paused count resumes only after pending writes settle.
- Search waits 250 ms after typing, aborts stale requests, ignores late
  answers, groups People / Projects / Moments in your sessions (messages arrive
  with channels), keeps the server's visibility labels, and remembers a query
  only when one of its results is opened. Recent searches use a per-person
  localStorage key; other people's keys are dropped when search mounts.
- Ask Tembo (cohort members only) opens `/dashboard/ask#ask-tembo=<words>`: the
  fragment never reaches the server, the Ask composer takes it once, fills the
  box unsent and strips it from the address. No channel endpoint is involved.

## Tests

- `npx vitest run src/components/platform/attention src/components/platform/search src/components/chat/Composer.test.tsx`
- `npx playwright test e2e/platform-overlays.spec.ts` against `astro dev`
  (`/dev/platform-overlays?persona=<fixture>&space=<space>&scenario=<s>&page=attention`;
  scenarios: default, slow, empty, many, error, readfail, expired, off,
  arrivals). On a deployed preview the same spec checks the harness is absent,
  that `/dashboard/attention` follows the flag, and the real APIs for a student.
- `OVERLAY_EVIDENCE=1 npx playwright test e2e/platform-overlays.spec.ts -g captures`
  saves review screenshots under `test-results/evidence/platform-overlays/`.
