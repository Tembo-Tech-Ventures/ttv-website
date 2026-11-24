# In-app calls

Video calls inside TTV: cohort sessions, check-ins and calls between two people, and community
events. The plan is in the SAM Library (`/plans/in-app-calls-2026-11-23/`: ARCHITECTURE, BUILD-PLAN,
UX-REVIEW); it is built one slice at a time, every slice dark behind the flags below.

What exists so far (slice P3a, migration 0043) is the foundation only: the tables, the flags (OFF),
the values in the contracts, and the recording policy's channel rule. Nothing reads or writes a call
yet, and nothing a person sees has changed.

## The rules (`rules.ts`)

The owner's decisions of 23 November 2026, which override the plan documents' 60 minutes. Each is a
named constant there, or data on the call (`bookedMinutes`, `limitMinutes`), never a literal where it
is enforced:

| Rule | Constant |
|---|---|
| Every call ends 90 minutes after its room opens | `CALL_LIMIT_MINUTES` |
| "15 minutes left" is said at 75 minutes | `CALL_WARNING_MINUTES_LEFT` |
| A check-in ends 30 minutes after both people are in | `CHECKIN_LIMIT_MINUTES` |
| Up to 15 people, one place always kept for a host | `MAX_PEOPLE_PER_CALL`, `SEATS_KEPT_FOR_HOST` |
| Recording spend alerts admins at $10 a month, and stops new recordings above $25 | `RECORDING_ALERT_USD`, `RECORDING_LIMIT_USD` |

No check-in recording is shared in the first release.

`rules.ts` also holds every value a column takes. It imports nothing, so the schema, the wire
contracts (`MeetingPurpose`, `MeetingState`, … in `lib/platform/contracts.ts`) and client islands
share one list.

## The tables (migration 0043)

Epoch milliseconds, like the other platform tables. Every call belongs to one channel (a cohort
channel, a direct conversation or a community channel), whose readers are its audience.

| Table | What it holds |
|---|---|
| `meeting` | One call on one date: its channel, purpose (SESSION, CHECKIN, CALL, EVENT), title, series, scheduled start, booked and limit minutes, recording policy (ALWAYS, BOTH_AGREE, HOST, NONE), state (SCHEDULED, LIVE, ENDED, CANCELLED), when it opened, must end and ended and why, a check-in's work and revision, its card, and the provider's meeting once the room first opens |
| `meeting_seat` | One place per person in a live call, the only thing a join token is minted for: role on joining, state (HELD, RELEASED, REMOVED), the provider's participant, last seen. Deleted when the call ends, so no record of who attended survives |
| `meeting_consent` | Each person's answer to recording a call between two people, with the version of the words they saw |
| `meeting_recording` | A call's recording on its way in, at most one per call: state, the provider's recording, seconds reserved and used, the file in the ingest bucket, the `recording` it became, retries |
| `call_proposal` | A suggested call in a direct conversation: up to three times, a check-in's work and revision, "ask to record", state. One OPEN per conversation |
| `meeting_usage_month` | TTV's own count of what calls cost, one row per UTC month, and when its alert went out |
| `recording.meetingId`, `recording.channelId` | The call a recording came from; a DIRECT or COMMUNITY recording's channel |
| `communityConfirmation.meetingId` | The check-in a confirmation cites: a citation, never a grant. NO ACTION: deleting a cited call, or the channel or cohort it is in, fails. Deleting the check-in's recording (a soft delete) removes the confirmation explicitly, in the same batch (slice P12) |

**Never rebuild a referenced table.** `recording`, `communityJourney`, `communityConfirmation` and
`studentProfile` are referenced with foreign keys on, and a rebuild's `DROP TABLE` fires their
cascades. `meeting` is now one of them too (recordings, confirmations and seats cite it), so it has no
table checks at all: its allowed values, title, a check-in's revision, "an end only when ended", its
minutes and its times are triggers (`meeting_values_*`, `meeting_shape_*`) that a later migration can
replace, where a changed table check would make drizzle-kit rebuild it. The other new tables are cited
by nothing, so they use checks. Nothing cites a call with a cascade that could delete people's work:
a confirmation's `meetingId` is NO ACTION, a recording's is SET NULL.

## Recording scopes fail closed

0042's triggers put any insert with a cohort and the scope `ADMIN_ONLY` in that cohort, and moved an
admins-only recording into a cohort with its `programId`. Drizzle always sends the column's default,
so an insert that meant "admins only" could not be told from one that named no scope. 0043:

- adds `recording.scopeChosen`, which every insert by this Worker sets (Drizzle's `$defaultFn`), and
  every insert names its scope (`cohortScope` in `lib/recordings/access.ts`);
- keeps only a Worker from before 0043 (no `scopeChosen`) putting an import with a cohort in that
  cohort (`recording_unscoped_insert`), so its Drive imports land where they did, during the deploy
  and after a rollback;
- only narrows on a cohort change: a COHORT recording moved out of every cohort is admins only
  (`recording_cohort_scope_leave`). Moving an admins-only recording into a cohort keeps it admins
  only; the admin recording page gives a recording with no cohort the cohort the admin chooses
  (`detailsUpdate`), and never widens one kept admins only within a cohort.

**Known gap, accepted (it fails closed):** while 0043 is applied but the old Worker still serves
(the deploy window, or after a rollback), an admin who gives a no-cohort recording a cohort on the
old Worker's recording page leaves it admins only, because that page relied on 0042's widening
trigger. Its cohort can't see it until an admin saves it again on the current Worker.

## Flags

| Flag | Turns on (in later slices) | Needs |
|---|---|---|
| `meetings` | The call room, cohort sessions, the admin calls page | `channels` and `spaces` |
| `meeting_checkins` | Suggesting calls in a conversation, check-ins, the Calls page | `meetings` and `mentor_requests` |
| `meeting_events` | Community events | `meetings` |

`REQUIRES` in `lib/platform/server/flags.ts` lists each flag's parents, and a flag is effective only
while it and every ancestor is. All three are seeded OFF. Only the owner moves one to ALL.

## Contracts

`lib/platform/contracts.ts` already has everything later slices add to, so they need not change it:
the attention kinds `meeting_soon`, `meeting_live`, `recording_deleted` and `recording_spend_alert`
(category updates; nothing produces them, and `attentionAccess` shows none until a slice adds the
`meeting` subject's branch); the subject `meeting`; and the card embeds `MeetingEmbed` and
`CallProposalEmbed` (`CallEmbed`), which are not `MessageEmbed`s: people never share them, and
nothing posts or renders them yet.
