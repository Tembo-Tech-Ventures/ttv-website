# Attention

`getAttentionCount(db, authenticatedUserId, capabilities)` returns currently
authorized unread attention items, with
all six `SpaceId` keys (including zeroes). The caller owns authentication,
`capabilitiesFor` (once), and the `spaces` flag check. Pass those current canonical
capabilities into the helper. Inaccessible spaces are zero; source ownership and
current cohort recording access are checked in the same indexed SQL query.
Deleted sources and unsupported future subject types fail closed. `/api/attention`, `/count`, and
`/read` enforce those checks and return 404 when disabled. `/api/platform/me` and
`getSpaceContext` reuse this helper with the same canonical capabilities; their
counts are no longer placeholders. PAT access is not added to either surface.

Lists use a 30-item keyset page, ordered by timestamp and opaque ID. The cursor
binds user, filter, and snapshot; mark-all uses the returned `snapshotAt` so newer
items remain unread. Counts use one indexed query; marking read uses an
owner-scoped update followed by the authoritative count. IDs in JSON are never
URL-decoded. Entity IDs embedded in destination paths are encoded once.

Filters: mentions = mention/reply/tembo_answer; requests = mentor_* and
access_request; updates = the remaining kinds. Category is stored, from one map in
`producers.ts`, to keep filtered paging indexed.

Existing post-commit producers cover application status changes (including bulk
admin changes), completed recording processing, mentor contribution confirmation,
and profile visitor messages. Recipients come from persisted domain records;
administrative actors come from authenticated callsites and are verified against
database roles, but admissions decision makers are never included in the item.
Visitor names, email, message text, recording titles, and mentor statements are not copied into attention. Replay keys use the source record and
event kind (plus the committed application plan status, whose existing state
machine is acyclic).
If another transition supersedes that status before the adapter reads it, the
stale event is omitted rather than attributed to the newer decision. Direct
admin enrollment creates an application rather than transitioning one; it is not
wired to attention. This is an explicit coverage gap alongside opportunity matches.

Persistence follows the **recipient's** effective `spaces` flag. OFF writes no
attention, STAFF requires recipient ADMIN authority, and flag failures fail
closed. Audience resolution happens once per producer or bulk operation; OFF
returns before domain reads. Enabled recipients use one set-based insert, with
STAFF eligibility checked against recipient database roles. There is no backfill.
Notification failure does not roll back or fail a
successful primary operation; a generic log records failure without private
details. This is best-effort delivery, not a durable transactional outbox.

Access requests (`src/lib/onboarding/README.md`): `access_request` fans out to
every administrator except the requester after the request commits, and is
visible only while that request is pending. `access_decided` is written inside
the deciding batch, selected by its `decisionId`, so it exists only if that
decision committed; it never names an actor, and only the requester sees it.

Shared work waiting for a mentor's confirmation is deliberately not attention:
sharing has no recipient or event, so the Mentoring space derives that count
instead (`src/lib/mentoring/README.md`).

`opportunity_match` remains a contract kind without a wired producer. Existing
`clientProject.MATCHED` is project-wide; `projectInterest` only stores
INTERESTED/WITHDRAWN and has no selected recipient. The coordinator explicitly
deferred this integration instead of inventing a personal match or broadcasting
to everyone interested. A future matching flow must define the authorized
recipient before this producer can be connected.

Channel events (B-2.5, `channel-producers.ts`; src/lib/channels/README.md,
"Moderation" §6): `message_hidden` to a hidden message's author (never naming
who hid it), `moderation_decided` to the author when an admin decides on a
case they knew of (B-3.2; only the case's current decision shows),
`moderation_pending` to admins for an open
moderation case and an author's review request, `mention` to each readable
person named in a message, and `tembo_answer` to the person whose question
Tembo answered (B-3.1). They follow the narrower of `spaces` and `channels` for the
recipient, read the committed state, and never copy message text. On read,
a `message` subject shows only while it still applies: the author's message is
still hidden, or for a decision its case still decided; the case still pending (admins);
or the mentioned message (or Tembo's answer) still visible in a channel the
reader can read, their own direct conversations included (B-4.1).

Mentor requests (B-4.1, `mentor-producers.ts`; src/lib/mentoring/README.md,
"Attention"): `mentor_request` and `mentor_withdrawn` to the mentor,
`mentor_accepted`, `mentor_redirected`, `mentor_declined` and `mentor_checked`
(a check held, kept or removed their request, QA4-02) to the person asking. A
`mentor_request` shows only while its request still waits for the mentor's
answer, so answering clears it from their panel and counts (QA4-07). They follow the narrowest of `spaces`, `channels` and
`mentor_requests`, and a `mentorRequest` subject shows only to the party its
kind was for.
