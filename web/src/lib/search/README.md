# Platform search v1

`GET /api/search` implements the existing `ROUTES.search`, `SearchQuery` and
`SearchResults` contracts. The client search store can consume it unchanged.
Every response is `no-store`. `spaces` OFF returns 404 before parsing or source
retrieval. Authentication is required; PATs and restricted staging fixture/QA
sessions remain denied. Middleware keeps its existing session restrictions.

The required scope is one of `all`, `cohort`, `community`, `messages`, `people`,
`projects`, `sessionMoments`. `q` is nonblank, at most 500 characters. Unknown or
duplicate parameters are rejected. The response echoes the validated query
unchanged, while matching trims it and uses SQLite's literal case folding.
SQL wildcard characters are literal. This is substring search, not semantic
matching, token expansion or ranking.

| Scope | Groups searched |
| --- | --- |
| all | People, authorized projects, own-cohort session moments |
| community | People and authorized projects; no recordings |
| cohort / sessionMoments | Explicitly accessible cohort transcripts |
| people / projects | Only the named group |
| messages | Empty until B-2.6 |

An optional `programId` narrows `all`, `cohort` or `sessionMoments` to that
authorized cohort, excluding people/projects. Incompatible or inaccessible
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
eligible owner profile. Only the owner or canonical institution/admin can read
them. `institution` does not mean community-public. Private projects never
appear, even for their owner. The `PRIVATE` visibility kind carries the explicit
label “Shared with approved institutions”; no institution enum is added.

Links use existing supported destinations: public talent profiles, an owner's
community workspace, the institutional profile view, and recording timestamps.
Project links open the containing profile/workspace; no unsupported revision or
project anchor is invented. Session quotes come from `transcript_segment` joined
to complete recordings in the authorized cohort, labeled “Only you and your
cohort”. Neither Vectorize metadata nor any model output supplies a citation.

The wire contract has no paging fields. V1 therefore returns at most 10 results
per group from a deterministic window of 500 authorized candidates, ordered by
source ID, with at most 4,000 searchable characters per text field and 500 in
each excerpt. Results outside that window are not exhaustive; callers should
narrow to a cohort where applicable. Search performs three capability reads and
at most three bounded source queries. It is request driven, not polled. Source
queries authorize before materializing content or matching. Candidate limits
bound text matching/materialization, not all SQLite authorization/join work.
There are no new indexes, migrations, dependencies, caches or runtime resources.

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
