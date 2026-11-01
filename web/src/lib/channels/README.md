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
| `GET /api/channels/:id/shareables?q=` | What the caller can attach here (B-2.4, "Embeds" below) |
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
  skipped when it did not. A reader never receives a hidden message's
  content. A capped backlog may name an id it never delivered (the message
  existed before the advanced checkpoint): only an opaque id, and evicting an
  unknown id is a no-op. Items come back in position order.
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
  foreign, reply or unseen parent is 404, a deleted or hidden one 409.
  Attached work is resolved first ("Embeds" below).
- **Idempotency.** `(authorId, clientNonce)` is unique. Repeating a post
  (same channel, thread, body and attached work) returns the original with 200, even when
  the requests race or the author can no longer post. Once the author has
  edited or deleted it, the same channel and thread are enough. Anything else
  under a used nonce is 409 `conflict`.
- **Rate limits** (`POST_LIMITS`): 10 posts per person per channel per
  minute, and 300 per person per rolling day across every channel. Deleted
  messages still count. A post counts for exactly the window, so
  `retryAfterMs` is when the oldest one stops counting. Index:
  `channel_message_author_idx` (migration `0030_channel_message_author.sql`).
- **Edit and reaction limits** (`ACTION_LIMITS`): 10 edits per person per
  channel per minute, and 30 reaction changes per person per minute across
  channels (429 with `retryAfterMs`). Each one moves the message for every
  poller, so they are limited too. They are logged in `channel_action`
  (migration `0031_channel_action.sql`) by the batch's first statement,
  which for an edit also checks the code of conduct; everything after it
  acts only when that row was written, so a refusal writes nothing and moves
  nothing. A trigger prunes the log after an hour. A refused edit or
  reaction, flagged or not, stays within the 10-statement budget. The
  screen an edit runs first is pure and in-process (see "Moderation" below),
  and Clef runs only after a write commits, so a refused edit pays for no
  model call.
- **Edits and deletes** belong to the author only; moderators hide instead
  (B-2.5), and nobody edits Tembo. Editing needs `canPost` and a current
  agreement; the same body again changes nothing (it answers with the
  unchanged message before any other check). Deleted and hidden messages
  are not edited (409). Deleting works in any channel the author can still
  read, clears the body and reactions, and keeps the message as a
  placeholder; deleting again returns the same placeholder.
- **Reactions** set a wanted state (`{kind, active}`), never a toggle, so a
  retry cannot undo itself. The write and the change to the message go in
  one batch, so the message also moves on a retry whose write changes
  nothing: a failed attempt cannot leave other readers with the old count. Anyone who reads an open channel reacts,
  announcements included. Archived channels (403), deleted and hidden
  messages (409) take none.
- **Moderation hook.** `moderation/screen.ts` `screenMessage` runs before
  every post and edit (see "Moderation" below). What it finds is stored as
  FLAGGED (the message stays visible) with a DETECTOR `moderation_event`, in
  the same batch as the write; an edit never clears an earlier flag.

## Moderation (B-2.5)

Plan §3 "Moderation pipeline". Contact details are only ever FLAGGED, never
hidden by a machine: a flagged message stays visible until a person decides
(owner decision 2, 2026-10-31). Migration `0032_moderation_pipeline.sql`.

### 1. Detectors, before the write

`moderation/detectors.ts` is pure and synchronous. `detectFindings(body)`
returns findings, each with a plain-language reason and an allowlist key:

| Finding | Reason | Key |
|---|---|---|
| Phone numbers: Kenyan 07xx/01xx and landlines, +254/254/00254, spaced, dotted, dashed, bracketed, spelled out in English or Swahili ("double seven" too), mixed, fullwidth or keycap digits; international numbers with + or 00; North American (555) 234-5678 | Shares a phone number | `phone:+254712345678` |
| Email addresses, also name [at] domain [dot] org, and name at gmail dot com for webmail domains | Shares an email address | `email:…` |
| WhatsApp and Telegram links: chat.whatsapp.com, wa.me, wa.link, api.whatsapp.com/send, whatsapp.com/channel, t.me, telegram.me, tg:// and whatsapp:// | Links to a WhatsApp or Telegram chat | `link:host/path` |
| Link shorteners (bit.ly, tinyurl.com, t.co, …) | Uses a shortened link | `link:host/path` |
| Five or more distinct `@` mentions | Mentions many people at once | none |
| The same text (20+ characters) by the same person in three channels within an hour | Posted the same message in several channels | none |

A digit run counts as a phone number only when it starts and ends where the
author's own grouping does, and has a phone number's shape. So years, dates,
times, prices, cohort numbers, versions (`10.0.19041.1234`: a tight chain of
digits is one number) and IP addresses are not flagged. The fixture table in
`detectors.test.ts` measures precision and recall for every kind, and
`KNOWN_LIMITS` there records what is deliberately missed (a Kenyan number
without its leading 0, commas between spelled digits) or caught (a
hyphenated ISBN-10). Clef asks about contact details too, so those are
covered after the post.

The allowlist and the repeat check are SQL inside the guarded INSERT or
UPDATE, so a refused write does no extra work. A finding is dropped when
`moderation_allowlist` holds its key or the whole text's key (`textKey`: a
SHA-256 of the text with case, Unicode forms and spacing normalised). Admins
fill the allowlist when they keep a message (the queue, next PR).

### 2. Clef, after the response

`moderation/clef.ts`. After a post is created or an edit changes the text,
`http.ts` hands Clef flash (`@cf/cloudflare/clef-flash`) to the request's
`waitUntil`; tests receive it through the `defer` seam. The request goes
through the AI Gateway with `collectLog: false`. Three questions, adapted
from the profile check: contact details, unrelated promotion, abuse.

- At or above its threshold (`CHANNEL_CLEF_THRESHOLDS`), a question flags
  the message with its reason. Abuse at or above `CHANNEL_CLEF_HIDE_THRESHOLD`
  (0.9) hides it: HIDDEN with no moderator (`hiddenBy` null). Contact
  details and promotion never hide.
- The check first reads whether the message still has the screened text,
  is not deleted or hidden, and is not allowlisted; otherwise Clef is not
  asked. The verdict is applied only while that still holds, and a verdict
  that adds no new reason changes nothing.
- A failure (no AI binding or gateway, a model error, an 8-second timeout,
  an answer that is not a probability for every question) leaves the
  message as it is and is logged as a warning (`recordError`), without the
  message. Fails open.
- Cost: one read, the model call and, for a verdict, one batch of two.

Refused posts and edits (posting right, code of conduct, rate limits) never
reach Clef: it runs only for a write that committed.

### 3. Evidence

`channel_message_version` keeps texts a message had, for moderators only
(the admin queue). Triggers write it, so no write path can skip it and none
spends a statement:

- an edit or delete keeps the text it replaced (EDIT, DELETE);
- a message flagged or hidden keeps its text as it was then (FLAG, HIDE),
  at the time of the moderation event the writer inserts first;
- a report keeps the text the reporter saw (REPORT).

A text equal to the newest one kept is not kept again. Edits and deletes of
a message nobody flagged, hid or reported are pruned after 14 days, as new
versions arrive; everything else stays with the message.

### 4. Cases

`moderation_case` is the admin queue: one row per message, kept by triggers
on `moderation_event`. A detector or Clef flag or hide (AI_FLAG), a report
(REPORT) or a channel moderator's hide (MENTOR_HIDE) opens a PENDING case or
adds to the open one (reasons merge, reports count, the strongest source
names it). An admin's decision closes it (DECIDED, with the decision, its
reason and who); an admin's hide with no case opens one already decided
(ADMIN_HIDE). A signal after a decision opens a new case.

### Embeds (B-2.4)

`embeds.ts`. A post sends references (`EmbedRef`, at most five, each once);
the server resolves them in one statement, stores what readers will see in
`channel_message.embeds`, and checks every one again on each read. Edits
never change embeds; deleting a message clears them. Link previews are off in
v1.

| Work | Shared when | Refused |
|---|---|---|
| Project (`journeyId` + `version`) | It is the poster's own published project (`communityJourney.visibility = 'institution'`) at its current revision | Missing or someone else's: 400, one answer for both. A private draft: 400, telling its owner to publish it. Any other revision: 409 `conflict`, so the composer offers the current one |
| Session clip (`recordingId`, `startSeconds`, `durationSeconds` ≤ 600) | The channel's `canShareSessionClip` (a cohort channel the caller may post in) and the recording is that program's, complete, with transcript in the window | Community, DIRECT and other cohorts' channels, before anything is read; a missing or another cohort's recording, with the same answer; unfinished, past the recording's end, or nothing to quote: 400 |

- **Whose consent.** A project's owner sharing it is the consent for that
  channel's readers, so nobody shares another person's work (`institution`
  visibility alone is not community-public; see `src/lib/search/README.md`).
  A clip goes only where every reader can see the recording: every reader of
  a cohort channel (members, alumni, instructors, TAs, invited mentors,
  admins) has that cohort's recordings.
- **Stored.** A project keeps its title, a summary of its description (500
  characters), no skills (projects have none of their own) and its https
  evidence link (`link: null` without one, or for anything else: no TTV page
  is open to every reader, coordinator seq 382). It is a snapshot of the
  shared revision: an owner who edits the project to remove something must
  make it private, or delete the message, to take the old text out of the
  channel. A clip keeps the recording's title and a quotation of the
  transcript segments overlapping its window (280 characters).
- **Screened.** Projects are not moderated where they are written, and every
  reader sees them, so the moderation screen gets the body followed by each
  shared project's title, summary and link (`screeningText`). Contact details
  and invite links in attached work are flagged like those in the body. Clip
  quotations are the session's own words and are not screened. Edits change
  only the body, so they screen only the body.
- **On every read** (`EMBED_ACCESS_COLUMN`, a column of the page's own
  statement, so pages cost no extra statement): a project must still exist,
  belong to the message's author and be published; a recording must still be
  complete and in the channel's cohort. Otherwise the reader, author
  included, gets `{type: "unavailable", was}` with no title, ids or
  quotation. A project's confirmations are read live: each mentor's latest
  confirmation at or before the shared revision, with the revision it
  confirmed. An edited project keeps showing the revision that was shared;
  publishing a private project again brings its card back.
- **Not pushed.** A change to the work alone does not move the message, so a
  `since` poll does not carry it: an open page shows the change when it next
  reads that message (a fresh latest page, or any change to the message).
  Every new read is checked.
- **Search (B-2.6).** The stored snapshot must never be indexed for search
  without the same read-time check, or private and moved work would come back
  through search.
- **Retries.** A repeated post returns the original even if the work has
  changed since; the same nonce with different work is 409.

`listShareables` (`GET /api/channels/:id/shareables`, and
`getRouteChannelShareables(Astro)` / `loadChannelShareables` for page
frontmatter, which give null where the caller cannot post) is what the
composer's attach tools offer: the caller's own published projects at their
current revision (50, most recently changed first), and only where
`canShareSessionClip`, 60-second clips (`CLIP_SECONDS`, cut at the session's
end): from the start of each of the 10 newest complete recordings with a
transcript there, or with `q`, up to 20 transcript moments that mention it
(case-insensitive substring, as in search). A substring cannot use an index,
so `q` reads only the transcripts of the cohort's 50 newest complete sessions
(`SHAREABLE_LIMITS.searchedSessions`); callers should debounce it and abort
stale requests. Everything listed posts as listed
while nothing changes. Restricted staging identities cannot post, so the route
is not on their allowlist.

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
`http.test.ts`): list channels 5, list messages 6 (7 with a thread), list
shareables 6 (7 where clips can be shared), post 7 (8 for a reply), mark read
8, edit 9, delete 9, react 10. A post that could be flagged (a finding, or
20+ characters, which could be a repeat) adds one for its moderation event,
flagged or not; an edit with a finding adds one; a post with embeds adds one,
to resolve them; embeds on a page add none. Clef's work after the response is
outside this budget: one read and one batch of two. Every one is an
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
`channel-conduct-migration.test.ts`, `channel-message-author-migration.test.ts`,
`channel-action-migration.test.ts`, `moderation-pipeline-migration.test.ts`
(evidence, pruning and case triggers);
`moderation/detectors.test.ts` (the detector fixture table, precision and
recall), `moderation/pipeline.test.ts` (detectors in the write path, the
allowlist, repeats, Clef with a mocked model, its failures and what hidden
messages show to whom);
beside this file `access.test.ts`, `conduct.test.ts`, `embeds.test.ts`
(sharing, refusals, later visibility changes, retries, shareables, plans),
`messages.test.ts`
(paging, polling, cursors, visibility), `mutations.test.ts` (posting,
idempotency, the conduct gate, rate limits, STAFF posting, the edit/delete
matrix, reactions, read markers), `http.test.ts` (flag, origin and token
gates, the access matrix, contracts, query budget), `http.middleware.test.ts`
(route files through the middleware) and `page.test.ts`;
`src/lib/platform/server/capabilities.test.ts` (the role matrix) and
`space-routing.test.ts` (the routes).
