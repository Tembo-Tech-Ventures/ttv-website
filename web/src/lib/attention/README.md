# Attention

`getAttentionCount(db, authenticatedUserId, capabilities)` returns currently
authorized unread attention items, with
all six `SpaceId` keys (including zeroes). The caller owns authentication,
`capabilitiesFor` (once), and the `spaces` flag check. Pass those current canonical
capabilities into the helper. Inaccessible spaces are zero; source ownership and
current cohort recording access are checked in the same indexed SQL query.
Deleted sources and unsupported future subject types fail closed. `/api/attention`, `/count`, and
`/read` enforce those checks and return 404 when disabled. PAT access is not added.

Lists use a 30-item keyset page, ordered by timestamp and opaque ID. The cursor
binds user, filter, and snapshot; mark-all uses the returned `snapshotAt` so newer
items remain unread. Counts use one indexed query; marking read uses an
owner-scoped update followed by the authoritative count. IDs in JSON are never
URL-decoded. Entity IDs embedded in destination paths are encoded once.

Filters: mentions = mention/reply/tembo_answer; requests = mentor_*; updates =
the remaining kinds. Category is stored to keep filtered paging indexed.

Existing post-commit producers cover application status changes (including bulk
admin changes), completed recording processing, mentor contribution confirmation,
and profile visitor messages. Recipients come from persisted domain records;
administrative actors come from authenticated callsites and are verified against
database roles. Visitor names, email, message text, recording titles, and mentor
statements are not copied into attention. Replay keys use the source record and
event kind (plus application status, whose existing state machine is acyclic).

Persistence follows the **recipient's** effective `spaces` flag. OFF writes no
attention, STAFF requires recipient ADMIN authority, and flag failures fail
closed. There is no backfill. Notification failure does not roll back or fail a
successful primary operation; a generic log records failure without private
details. This is best-effort delivery, not a durable transactional outbox.

`opportunity_match` remains a contract kind without a wired producer. Existing
`clientProject.MATCHED` is project-wide; `projectInterest` only stores
INTERESTED/WITHDRAWN and has no selected recipient. The coordinator explicitly
deferred this integration instead of inventing a personal match or broadcasting
to everyone interested. A future matching flow must define the authorized
recipient before this producer can be connected.
