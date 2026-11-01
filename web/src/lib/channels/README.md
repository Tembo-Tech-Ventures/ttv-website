# Channels

Human chat channels for cohorts and the community. Shipped dark behind the
`channels` flag, which stays OFF until the coordinator switches it. Plan: SAM
idea 01M68GQAP1DCSVMRJMZS771ZRB, §3; wire contracts in
`src/lib/platform/contracts.ts`.

## Schema (B-2.1, migration `0028_channels.sql`)

Timestamps are epoch milliseconds, like attention. Access is decided in
`capabilitiesFor` (B-2.2), never by these tables.

| Table | Holds |
|---|---|
| `channel` | COHORT (exactly one program), COMMUNITY or DIRECT; slug, name, topic, postingPolicy ALL or STAFF, position, archivedAt, seedKey |
| `channel_member` | DIRECT members and explicit extras only. Cohort and community membership is derived at read time |
| `channel_message` | The message, its thread parent, author, client nonce, embeds and citations JSON, edit/delete times and moderation state |
| `channel_read` | One read marker per person and channel |
| `message_reaction` | One row per person, message and reaction from the fixed set (desired state, not a toggle) |
| `message_report` | A member's report: one per person and message |
| `moderation_event` | Append-only audit trail: who flagged, hid, restored or kept what, from which source, and why |

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

NN is the number in the program's name, read as the homepage reads it
("Cohort 4" and "Cohort 04" are 04), when no channel uses that number yet.
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
program, including an upsert of an existing id, creates nothing.

Tests: `src/lib/db/migrations/channels-migration.test.ts`.
