# Channels

Human chat channels for cohorts and the community. Shipped dark behind the
`channels` flag, which stays OFF until the coordinator switches it. Plan: SAM
idea 01M68GQAP1DCSVMRJMZS771ZRB, §3; wire contracts in
`src/lib/platform/contracts.ts`.

## Schema (B-2.1, migration `0028_channels.sql`)

Timestamps are epoch milliseconds, like attention. Access is decided by
`channelAccessFor` beside `capabilitiesFor` (B-2.2, below), never by these tables.

| Table | Holds |
|---|---|
| `channel` | COHORT (exactly one program), COMMUNITY or DIRECT; slug, name, topic, postingPolicy ALL or STAFF, position, archivedAt, seedKey |
| `channel_member` | DIRECT members and explicit extras only. Cohort and community membership is derived at read time |
| `channel_message` | The message, its thread parent, author, client nonce, embeds and citations JSON, edit/delete times and moderation state |
| `channel_read` | One read marker per person and channel |
| `message_reaction` | One row per person, message and reaction from the fixed set (desired state, not a toggle) |
| `message_report` | A member's report: one per person and message |
| `moderation_event` | Append-only audit trail: who flagged, hid, restored or kept what, from which source, and why |
| `channel_conduct` | (B-2.2, migration `0029_channel_conduct.sql`) One row per person: the latest code of conduct version they agreed to, and when |

### Invariants the database enforces

- **Slugs.** Lowercase letters, digits and inner hyphens, at most 80
  characters. Unique among cohort and community channels; DIRECT
  conversations may share one.
- **Ordering.** `seq` is a message's fixed position in its channel and
  `changeSeq` its latest change. Both come from one per-channel counter,
  `MAX(changeSeq) + 1`, assigned inside the writing statement, so D1's
  serialised writes keep it strictly increasing. Both are unique per channel,
  and `changeSeq >= seq`. Paging reads `seq` (`channel_message_thread_idx`);
  `since` polling reads `changeSeq` (`channel_message_changeSeq_idx`), so
  edits, deletions and moderation reach clients that already hold the message.
  Ids are not cursors.
- **Threads** are one level deep, by convention in the API. The database
  guarantees that a reply's parent is in the same channel: the composite key
  is `(parentId, channelId)` → `(id, channelId)`. A read marker must also
  point at a message in its own channel.
- **Idempotent posting.** `(authorId, clientNonce)` is unique: a retried post
  finds the message it already created, in any channel. Messages without a
  nonce never collide.
- **Tembo** has no account (`authorId` is null) and only answers inside the
  thread that asked (`parentId` is set). A USER message with a null author
  belongs to a deleted account, shown as "Deleted user".
- **Moderation.** FLAGGED and HIDDEN always carry at least one reason.
  `hiddenAt` is set exactly when the message is HIDDEN, and only hidden
  messages name who hid them. Detector and Clef events have no actor.
- **Bodies.** At most 10,000 characters, and never blank unless deleted.
  Embeds, citations and reasons are JSON arrays.

Deleting a person keeps their messages (author set to null) and the
moderation history (actor set to null), and removes their reactions, reports,
read markers and memberships. Deleting a channel, or the program a cohort
channel belongs to, removes its messages and everything attached to them.

## Access (B-2.2)

`channelAccessFor(capabilities, channel, { isMember })` in
`src/lib/platform/server/capabilities.ts` is the one rule set, over
`capabilitiesFor`'s result. Pages, the channel APIs, search and Tembo all
decide through it; `CHANNEL_ACCESS_MATRIX` in `capabilities.fixtures.ts` is
the parameterised role matrix every surface can reuse.

| Channel | Reads | Posts | Moderates |
|---|---|---|---|
| COMMUNITY | Every signed-in person, institutions included | Everyone who reads it | Admins and global mentors |
| COHORT | That program's members (APPROVED, AUDIT and COMPLETED, so alumni stay after the cohort ends), its INSTRUCTOR, TA and MENTOR assignments, and admins | Everyone who reads it | Its instructors, TAs and mentors, and admins |
| DIRECT | Explicit `channel_member` rows only (Phase 4) | Its members | Nobody in place |

- **postingPolicy STAFF** (the `cNN-announcements` channels): only admins,
  and on a cohort channel its instructors and TAs, post. Mentors and members
  read.
- **Archived** channels stay readable and take no new posts.
- **Session clips** are shared only where every reader can see the
  recording: a cohort channel the caller may post in.
- Pending and rejected applicants have the Cohort space but no cohort
  channels. A global MENTOR role moderates community channels only; a cohort
  is joined through a per-program MENTOR assignment.
- A `channel_member` row opens DIRECT conversations only. It never opens
  another cohort's channels.
- `teachingCohortIds` (INSTRUCTOR/TA assignments) is a server-only field of
  `capabilitiesFor`; `Me` never serializes it.

### Listing and opening channels

`access.ts` holds the reads; callers own the `channels` flag.

- `listChannelsFor(db, user, capabilities?)` → `Channel[]`: every channel the
  caller can read, with its capabilities, in display order (cohort channels,
  newest cohort first; then community; then direct; archived last in each
  group; then position and name). `unreadCount` is the caller's unread
  messages (see "Read markers and unread counts" below). `lastMessageAt` is
  the newest message nobody hid or deleted. Four reads (capabilitiesFor's
  three and one indexed channel read), or one when the caller passes
  capabilities it already holds.
- `findChannelById(db, user, channelId, capabilities?)` → `Channel | null`:
  the same lookup by id, for the `/api/channels/:id` routes. Another cohort's
  channel and a missing id give the same null.
- `findReadableChannel(db, user, { space, slug })` → `Channel | null`: a
  cohort channel in Cohort, a community channel in Community. A missing slug,
  a channel in the other space and a channel the caller cannot read all give
  null, through the same queries.

### Routes

`/dashboard/cohort/c/<slug>`, `/dashboard/community/c/<slug>` and
`/dashboard/community/conduct` (`space-routes.ts`) are 404 for every method
until `channels` is on for the caller. A channel page is then 404 unless the
caller can read that channel, whatever the reason, so no slug confirms that
another cohort's channel exists. Personal access tokens get 403, as on every
spaces page. The page frontmatter reads the same lookup through
`getRouteChannel(Astro)` (`src/lib/platform/server/channel-context.ts`),
once per request. Restricted staging identities may GET these pages only.

Capabilities are read once per request through
`requestCapabilities(db, Astro.locals)`
(`src/lib/platform/server/request-capabilities.ts`): `/me`, the space router,
`getRouteChannel`, page frontmatter and the channel APIs share that one
lookup. Nothing outlives the request, so a revoked role takes effect on the
next one.

### Code of conduct

`conduct.ts`: `getConductAcknowledgement(db, userId)` and
`acknowledgeConduct(db, userId, version?)` return a `ConductAcknowledgement`
(`version`, `acknowledgedAt`, `current`). Raise `CONDUCT_VERSION` whenever the
text changes in substance: `current` turns false for everyone who agreed to
an older version, so the page asks again. An agreement never moves back, and
agreeing again to the same version keeps its date. Posting and editing need
a current agreement (B-2.3): without one they answer 403 `conduct_required`,
so a new version asks again before the next post. Reading, reacting,
deleting your own message and read markers do not.

## Messages (B-2.3)

### APIs

`http.ts` serves the routes in `src/pages/api/channels/**` and
`src/pages/api/messages/**`, validated against `ROUTES` in
`src/lib/platform/contracts.ts` on the way in and out.

| Route | Does |
|---|---|
| `GET /api/channels` | `listChannelsFor`, with unread counts |
| `GET /api/channels/:id/messages?before\|since&thread` | A page of messages (below) |
| `POST /api/channels/:id/messages` | Post; idempotent on `clientNonce` (201 new, 200 repeat) |
| `POST /api/channels/:id/read` | Move the read marker forward |
| `PATCH /api/messages/:id` | The author edits |
| `DELETE /api/messages/:id` | The author deletes; a placeholder stays |
| `POST /api/messages/:id/reactions` | Set one fixed reaction on or off |

Every route:

- is 404 `flag_off` while `channels` is off for the caller, before any
  channel data is read, and 404 when signed out;
- is 404 for a channel the caller cannot read, a message in one, and another
  person's hidden message, with the same body as for an id that does not
  exist;
- refuses personal access tokens (403) until B-2.7 adds channel scopes.
  Community tokens never get past the middleware. Agent sessions act as their
  person, under the same rules;
- needs the same origin for writes (403 otherwise);
- answers in the platform error envelope, and records unexpected failures
  without details (500 `server`).

Restricted staging identities (demo, QA, fixtures) may GET the channel list
and message pages, which the channel pages poll. Fixtures may also move their
own read markers, which their cleanup deletes with the user. Nobody restricted
posts, edits or reacts: retained personas have no cleanup.

### Reading messages

`messages.ts`. A feed is a channel's root messages, or one thread's replies
(`thread` = the root's id). Each page is one SQL statement: the messages with
their authors, display badges, reactions and thread summaries, and the
channel's change counter, all from one snapshot.

- **Latest** (no cursor): the newest `PAGE_SIZE` (50) of the feed, oldest
  first. `beforeCursor` is null when nothing older exists.
- **`before`**: the page before that cursor. Walking `beforeCursor` back
  returns every message once, in order, with no gaps.
- **`since`**: every change after the checkpoint, contiguous and in change
  order, at most `SINCE_LIMIT` (100). New messages, edits, deletions,
  reactions and moderation all move a message's `changeSeq`, and a reply
  moves its root's too, so thread summaries stay fresh. `sinceCursor`
  checkpoints exactly what was returned: a capped delta continues on the next
  poll. A change to a message this reader may no longer see becomes a
  `removedIds` entry when the message existed at the checkpoint, and is
  skipped when it did not, so a newcomer never learns a hidden id. Items come
  back in position order.
- A since page's `beforeCursor` reaches the messages older than the oldest
  message the page *adds* (edits in it are of messages already cached), or is
  null when it adds none. This is the window the channel store files the
  delta under.
- Cursors are opaque and bound to their feed and direction: another channel's
  or thread's cursor, or a `since` cursor sent as `before`, is 400
  `validation`. A cursor past the channel's counter (a reset preview database)
  or from another cursor format is 410, and the store takes a fresh page.
- A `thread` that is not a root of this channel the reader can see (a reply,
  another channel's message, a hidden root) is 404.

Per message, for this reader:

- Hidden messages reach only their author and the channel's moderators. Only
  they get `moderation` (state and reasons); everyone else gets `null`, so a
  flag is invisible to other readers.
- Deleted messages keep their place with an empty body, no embeds, citations
  or reactions.
- `clientNonce` comes back to its author only.
- Display badges, never permissions: Staff, Mentor and Institution partner
  everywhere; a cohort's Instructor, TA, Mentor, member and alumni badges only
  in that cohort's channels. Tembo has the AI badge; a deleted account is
  "Deleted user".
- The thread summary counts replies everyone can see (not deleted, not
  hidden), so it is the same for every reader.

`page.ts`: `loadChannelPage(db, d1, viewerId, channel, { thread })` gives
page frontmatter the latest page, the open thread (null when the `?thread=` id
is not one this reader can open) and the read marker, so a channel reads
without JavaScript. `getRouteChannelPage(Astro)` in
`src/lib/platform/server/channel-context.ts` wraps it for the channel pages.
Neither moves the read marker.

### Writing

`mutations.ts`. Every condition that decides a post is checked inside the
INSERT, so concurrent requests cannot both pass a check one of them should
fail; when nothing was written, one read of the same conditions says why.

- **Posting** needs `canPost` (the channel's `postingPolicy`, and not
  archived), a current code of conduct agreement (403 `conduct_required`), and
  room in the rate limits (429 `rate_limited` with `retryAfterMs` and
  `Retry-After`). A reply needs an open root of the same channel: a missing,
  foreign, reply or unseen parent is 404, a deleted or hidden one 409. Embeds
  are refused (400) until B-2.4 resolves them.
- **Idempotency.** `(authorId, clientNonce)` is unique. Repeating a post
  (same channel, thread and body) returns the original with 200, even when
  the requests race or the author can no longer post. Once the author has
  edited or deleted it, the same channel and thread are enough. Anything else
  under a used nonce is 409 `conflict`.
- **Rate limits** (`POST_LIMITS`): 10 posts per person per channel per
  minute, and 300 per person per rolling day across every channel. Deleted
  messages still count. A post counts for exactly the window, so
  `retryAfterMs` is when the oldest one stops counting. Index:
  `channel_message_author_idx` (migration `0030_channel_message_author.sql`).
- **Edits and deletes** belong to the author only; moderators hide instead
  (B-2.5), and nobody edits Tembo. Editing needs `canPost` and a current
  agreement; the same body again changes nothing. Deleted and hidden messages
  are not edited (409). Deleting works in any channel the author can still
  read, clears the body and reactions, and keeps the message as a
  placeholder; deleting again returns the same placeholder.
- **Reactions** set a wanted state (`{kind, active}`), never a toggle, so a
  retry cannot undo itself. Anyone who reads an open channel reacts,
  announcements included. Archived channels (403), deleted and hidden
  messages (409) take none.
- **Moderation hook.** `moderation.ts` `screenMessage` runs before every
  post and edit and is a passthrough today. Reasons it returns are stored as
  FLAGGED (the message stays visible) with a DETECTOR `moderation_event`, in
  the same batch as the write; an edit never clears an earlier flag. B-2.5
  puts its detectors here.

### Read markers and unread counts

- Only `POST /api/channels/:id/read` moves a marker, and only forwards (by
  seq). Reading pages, lists and threads never moves it. A message from
  another channel, or one hidden from the reader, is 404.
- Unread: root messages after the marker (all of them without one) that
  someone else wrote and nobody deleted or hid, capped at `UNREAD_COUNT_CAP`
  (100; the UI shows "99+"). Thread replies reach people through attention.
  One definition (`unreadCount` in `access.ts`) serves the channel list, the
  read response and the page.

### Query budget

Statements per request, with flags read from the database (asserted in
`http.test.ts`): list channels 5, list messages 6 (7 with a thread), post 7
(8 for a reply), mark read 8, edit 9, react 9, delete 9. Every one is an
indexed read; the plans are asserted in `messages.test.ts`,
`mutations.test.ts` and `access.test.ts`.

## Seeded channels

- **Community**: `introductions`, `show-your-work`, `help`, `opportunities`
  and `design-crit`, open to every signed-in member. They are seeded once, as
  a set: when any of them exists, the set is left as staff have shaped it.
- **Cohort**: every program gets `cohort-NN`, `cNN-help` and
  `cNN-announcements` (postingPolicy STAFF). They stay open after the cohort
  ends (owner decision, 2026-10-31). There is no WhatsApp bridge.

`seedKey` (`community:<slug>`, `cohort:<programId>:main|help|announcements`) is
the stable identity of a channel the platform created, so a channel staff
rename is never created again.

### Cohort numbers

NN is the number straight after "cohort" in the program's name ("Cohort 4"
and "TTV Cohort #04" are 04; "TTV 2025 Cohort 4" is 04 too, where the homepage's
first-digits rule would read 2025), when no channel uses that number yet.
Otherwise it is the next number above every cohort number in use, in channel
slugs or program names. A second "Cohort 4", or a program with no number in
its name, therefore takes the next free number. Existing programs were
numbered with named ones first, so they keep their numbers.

### The creation hook

Creating a program creates its channels in the same statement, whichever way
the program is created: the admin form, the data import, or preview and
staging fixtures. The trigger `program_cohort_channels` inserts the program id
into the view `cohort_channel_request`, whose INSTEAD OF trigger holds the one
implementation. The migration's backfill uses that same view.

The hook cannot make a program insert fail. A program that already has seeded
channels is skipped, and each insert first checks that its slug is free; a
slug that is somehow taken leaves that channel out instead. Updating a
program, including `INSERT … ON CONFLICT(id) DO UPDATE` on an existing id,
creates nothing.

**Never `INSERT OR REPLACE INTO program`.** REPLACE deletes the existing row
first, and the cascade deletes the program's channels and every message in
them. The trigger then creates fresh, empty channels with new ids. Fixtures
that re-seed programs must use `ON CONFLICT(id) DO UPDATE` (the local persona
seed, `e2e/platform-personas.local.sql`, still uses REPLACE and needs this
change before re-seeding a database that holds messages).

**Rebuilding `program` or `channel`.** A migration that rebuilds either table
(create, copy, drop, rename) must drop and recreate `cohort_channel_request`,
its INSTEAD OF trigger and `program_cohort_channels`: SQLite refuses the
rename while the view or trigger names a missing table, and dropping
`program` silently drops the hook. The migration test applies every
migration and fails if new programs stop getting their channels.

Tests: `src/lib/db/migrations/channels-migration.test.ts`,
`channel-conduct-migration.test.ts`, `channel-message-author-migration.test.ts`;
beside this file `access.test.ts`, `conduct.test.ts`, `messages.test.ts`
(paging, polling, cursors, visibility), `mutations.test.ts` (posting,
idempotency, the conduct gate, rate limits, STAFF posting, the edit/delete
matrix, reactions, read markers), `http.test.ts` (flag, origin and token
gates, the access matrix, contracts, query budget), `http.middleware.test.ts`
(route files through the middleware) and `page.test.ts`;
`src/lib/platform/server/capabilities.test.ts` (the role matrix) and
`space-routing.test.ts` (the routes).
