# Platform search v1

`GET /api/search` implements the existing `ROUTES.search`, `SearchQuery` and
`SearchResults` contracts. The client search store can consume it unchanged.
Every response is `no-store`. `spaces` OFF returns 404 before parsing or source
retrieval. Authentication is required; PATs and restricted staging fixture/QA
sessions remain denied. Middleware keeps its existing session restrictions.

The required scope is one of `all`, `cohort`, `community`, `messages`, `people`,
`projects`, `sessionMoments`. `q` is nonblank, at most 500 characters. Unknown or
duplicate parameters are rejected. The response echoes the validated query
unchanged, while matching trims it and applies SQLite's ASCII-only case folding
to both the query and source. Non-ASCII letters match their exact case.
SQL wildcard characters are literal. This is substring search, not semantic
matching, token expansion or ranking.

| Scope | Groups searched |
| --- | --- |
| all | People, authorized projects, own-cohort session moments, messages in readable channels |
| community | People, authorized projects, and messages in community channels; no recordings |
| cohort | Explicitly accessible cohort transcripts, and messages in readable cohort channels |
| sessionMoments | Explicitly accessible cohort transcripts |
| people / projects | Only the named group |
| messages | Messages in readable channels |

An optional `programId` narrows `all`, `cohort` or `sessionMoments` to that
authorized cohort (messages to that cohort's channels), excluding
people/projects. Incompatible or inaccessible
cohort scopes return the same 403 without revealing whether a cohort exists.
All four groups are always present.

`capabilitiesFor` runs once per search. No implicit administrator, global
mentor or institution recording override is used. Approved/audit/completed
members and assigned instructors/TAs/mentors receive only their explicit
cohorts. Demo identities are additionally limited to demo public profiles and
their canonical demo cohort. Revocation is effective on the next request.

People require a published `studentProfile` and a completed application with
`completedAt`, matching the existing public talent page. Only public identity
snapshots are searched or emitted; private authentication names, emails and
moderation fields are excluded. Project results use current `communityJourney`
revisions with `institution` visibility, and additionally require a publicly
eligible owner profile. Mentor/admin owners are excluded. Only the owner or
canonical institution/admin can read them.

Institutional discovery's shared rule, `discoverableMember` in
`src/lib/community/eligibility.ts` (owner decision 2026-11-01), requires a
saved community profile, no MENTOR or ADMIN role, and not the caller. The
INSTITUTION role never excludes an otherwise eligible member. Institution
callers see only such people and such owners' shared projects. Admins keep
their reach: the public talent directory, and shared projects of every owner
who is not a mentor or admin. A caller holding both ADMIN and INSTITUTION is
an admin here. Everyone else sees the public talent directory unchanged.

`institution` does not mean community-public. Private projects never
appear, even for their owner. The `PRIVATE` visibility kind carries the explicit
label “Shared with approved institutions”; no institution enum is added.

Links use existing supported destinations: public talent profiles, an owner's
community workspace, the institutional profile view, and recording timestamps.
Project links open the containing profile/workspace; no unsupported revision or
project anchor is invented. Session quotes come from `transcript_segment` joined
to complete recordings in the authorized cohort, labeled “Only you and your
cohort”. Neither Vectorize metadata nor any model output supplies a citation.

The wire contract has no paging fields. V1 therefore returns at most 10 matches
per group in deterministic order, with at most 500 characters in each excerpt.
Matching applies to the full authorized source before the result limit: late
segments in long recordings and profiles/projects beyond the first 500 records
remain searchable. Display fallback names and JSON skill punctuation are not
search evidence. Search performs three capability reads and at most three
source queries, plus two for messages ("Messages" below). It is request driven, not polled. Transcript retrieval drives
the segment lookup from authorized complete recordings, never a sample of the
global segment table. Query work scales with authorized source text; the result
cap bounds response size rather than pretending to cap all database work.
Migration `0024_search_source_indexes` adds `recording(programId)` and
`transcript_segment(recordingId,startTime,id)` indexes. Query-plan tests assert
both lookups and reject a global segment scan. The migration is idempotent and
does not rebuild tables or alter data.
There are no new dependencies, inference calls, caches or runtime resources.

## Messages (B-2.6)

`messages.ts`. Messages are searched only while the `channels` flag is on for
the caller (read from the same request's flags, so it costs no statement); off,
`messages` is empty and no channel is read.

- **Index.** Migration `0033_channel_message_search` adds
  `channel_message_search` (one row per searchable message: its id and body)
  and `channel_message_fts`, an FTS5 index over it (`unicode61`, diacritics
  removed). Triggers on `channel_message` keep it current on every write path:
  a post adds the row, an edit re-indexes it in place, an author's delete (the
  placeholder) or a hide removes it, a restore adds it back, and deleting the
  row (its channel or program went) takes it out. Reactions, flags and polling
  counters leave it alone. The migration backfills existing messages and
  reapplies without duplicates. The index keys on its own integer key, never
  `channel_message`'s implicit rowid, so a rebuild cannot mismatch ids and
  bodies (`src/lib/channels/README.md`, "Rebuilding").
- **What is searchable.** The body only. Deleted and HIDDEN messages are not in
  the index, for anyone: their authors and moderators included (the admin
  queue is where moderators find them), and neither are replies under a hidden
  root. FLAGGED messages stay visible, so they stay searchable. Stored embed
  snapshots are never indexed: embeds are checked again on every read
  (`EMBED_ACCESS_COLUMN`), and an index cannot be.
- **Access.** `readableChannelRefs` (`src/lib/channels/access.ts`) reads the
  candidate channels once and keeps those `channelAccessFor` lets the caller
  read: community channels for every signed-in person, institutions included;
  a cohort's channels for its members (alumni too), instructors, TAs, invited
  mentors and admins; DIRECT conversations for their members only. Direct
  conversations have no page yet (Phase 4), so none is a result until one
  exists. Revocation is effective on the next search. Demo identities search
  exactly the channels their channel pages open (capabilitiesFor already
  confines them to the demo cohort); fixture and QA sessions stay denied.
- **Queries are text.** Each whitespace-separated term of `q` (at most 16)
  becomes a quoted FTS5 string, quotes doubled, so FTS5 syntax typed into
  search (quotes, `AND`/`OR`/`NOT`, `NEAR`, `*`, `^`, column filters,
  parentheses) never acts as syntax. Control characters separate terms. A term
  without a letter or digit is dropped; a query without one reads nothing.
  Every term must match; terms of three characters or more also match words
  they begin ("webh" finds "webhook"). Case and diacritics are ignored.
- **Results.** The newest 10 matches (in the order first indexed: an edit keeps
  a message's place). The FTS5 index drives the read newest first, each match
  joins its message by primary key, and the read stops at 10 readable ones; the
  plan is asserted (no table scan, no sort). The excerpt is plain text around
  the match, at most 24 words and 280 characters. Authors are names and
  avatars without channel badges (Tembo and "Deleted user" as in channels).
  `href` opens the channel at the message (`?message=`), or its thread
  (`?thread=<root>&message=`). Visibility reads `#slug · only this cohort` or
  `#slug · signed-in members`.
- **Budget.** Two statements: the readable channels and the match. A `messages`
  search is six statements with flags read from the database (flags,
  capabilitiesFor's three reads, channels, match), `all` nine. The match reads
  index entries newest first until ten are readable, so its work grows with
  the matches it passes in channels the caller cannot read, never with the
  size of the message table.

This task forbids new inference. The existing semantic transcript tool embeds
the query and searches Vectorize globally before filtering; v1 deliberately
does not invoke it. Tests pass failing AI/Vectorize sentinel mocks and assert
zero calls. Any future semantic retrieval needs authorization pushed into
retrieval, a bounded inference budget and a separate approved change.

`npx vitest run src/lib/search` exercises actual migration-backed SQLite/D1 SQL,
REST and retrieval role matrices, cross-cohort inputs/outputs, private sources,
demo boundaries, revocation, exact contract validation, bounded results and
failure paths. Failures return one generic error, never partial groups or raw
database/source details.
