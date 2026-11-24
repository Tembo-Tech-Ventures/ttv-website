# In-app calls

Video calls inside TTV: cohort sessions, check-ins and calls between two people, and community
events. The plan is in the SAM Library (`/plans/in-app-calls-2026-11-23/`: ARCHITECTURE, BUILD-PLAN,
UX-REVIEW); it is built one slice at a time, every slice dark behind the flags below.

What exists so far is the foundation: the tables, the flags (OFF), the values in the contracts and
the recording policy's channel rule (slice P3a, migration 0043); and who may join, the provider
interface with a fake, the seats, the state machine and the API routes (slice P3b). Nothing a person
sees has changed: no page uses the routes yet (the room is slice P5), and every route is 404 while
`meetings` is off. The real provider, RealtimeKit, and the every-minute clock arrive in slice P4.

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
| A session or event with no host in it for 5 minutes ends | `NO_HOST_END_MINUTES` |
| A call between two people the second never joins ends 15 minutes after it opened | `NOBODY_CAME_END_MINUTES` |
| An empty room ends 2 minutes after the last person left | `EMPTY_ROOM_END_MINUTES` |
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

**The deploy window's row (it fails closed, then is put right):** while 0043 is applied but the old
Worker still serves (the deploy window, or after a rollback), an admin who gives a no-cohort
recording a cohort on the old Worker's recording page leaves it admins only, because that page relied
on 0042's widening trigger. That is the only way to get a recording admins only within a cohort with
no `scopeChosen`, so `detailsUpdate` puts such a row in its cohort (and marks the scope chosen) the
next time an admin saves it on the current Worker, even with nothing changed. One a current Worker
inserted and the old one then gave a cohort has `scopeChosen` set, and stays admins only until an
admin moves it out of the cohort and back.

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

## Who may join (`access.ts`)

`meetingAccessFor(capabilities, channel, purpose, { isMember })` decides, beside `channelAccessFor`,
what a person may do with a call: see it (its details and card), join it (take a seat) and host it
(open the room, remove a member, end it, and schedule one in that channel). A call's audience is its
channel's readers, so the call and its chat never disagree; the purpose decides who hosts:

| Purpose | Channel | See and join | Host |
|---|---|---|---|
| `SESSION` | its cohort's channel | that cohort's members and alumni, its instructors, TAs and invited mentors, admins | its instructors and TAs, admins |
| `CALL`, `CHECKIN` | a direct conversation | its two members, nobody else (admins included) | both members |
| `EVENT` | a community channel | every signed-in person | the channel's moderators (admins, mentors) |

A call in any other kind of channel admits nobody. In an archived channel people still see a call
but can't join or host it. A global role alone grants nothing: an admin outside a conversation, a
mentor outside a cohort or an institution account gets only what the channel gives.
`access.test.ts` holds the whole matrix.

## The provider (`provider.ts`)

`CallProvider` is everything TTV asks of the media provider: create a meeting (only when a host first
opens the room, since provider meetings can never be deleted), add a participant and get their
token, delete a participant (which revokes their tokens at once), end a meeting (everyone out, no
new joins), and start and stop its recording. The server makes every call from its own rows: no
request ever carries a provider meeting, participant or recording id, a preset, a role or a storage
setting. The one preset and the recording storage belong to the adapter and the provider's app.

`FakeCallProvider` keeps the real one's rules in memory, and serves local runs, tests and previews:
a preview never makes provider apps it could not delete. A meeting another isolate made counts as
open. Production has no provider until slice P4 brings the RealtimeKit adapter and its settings:
there every meeting route answers 503, never a pretend call (`callProviderFor`).

## Seats (`seats.ts`)

A seat is the only thing a join token is minted for, one per person per call. The claim is one
conditional `INSERT … ON CONFLICT` in a D1 batch, and D1 runs one write at a time, so two people
never take the last place: a host needs a free place among `MAX_PEOPLE_PER_CALL`; a member also
leaves `SEATS_KEPT_FOR_HOST` places for hosts not yet in, so members hold at most 14 while no host is
in. 20 people joining at once get exactly 15 seats (`http.test.ts`). The role is the server's: a host
of the call takes a `HOST` seat, everyone else a `MEMBER` one.

- Joining again (another tab) keeps the seat and deletes the earlier provider participant, so the
  older tab's token stops working.
- Leaving releases the seat (`RELEASED`) and deletes the participant.
- A host removes a member (never a host or themself): the seat becomes `REMOVED` for good, and the
  participant is deleted. A removed seat keeps its participant until the provider confirms the
  deletion, so a removal the provider failed (503) is finished by trying again.
- If the provider fails to add someone, the seat they claimed goes back.
- When the call ends, every seat is deleted: no record of who attended survives.

## The clock (`clock.ts`)

`advanceMeeting(ctx, meetingId)` holds every rule about a call's end, from `dueEnd`, a pure function
of the call, its seats and the time: `SCHEDULED → LIVE → ENDED`, or `SCHEDULED → CANCELLED`.

- A host's join opens the room: the provider meeting is made, the call is `LIVE` with
  `hardEndAt = openedAt + limitMinutes`. A check-in's `hardEndAt` is set when the second person takes
  their seat.
- It ends at `hardEndAt` (`LIMIT`); an empty room after `EMPTY_ROOM_END_MINUTES` (`EMPTY`); a
  session or event with no host after `NO_HOST_END_MINUTES` (`NO_HOST`); a call between two people
  the other never joined after `NOBODY_CAME_END_MINUTES` (`NOBODY_CAME`); or when a host ends it
  (`HOST_ENDED`).
- Ending stops the recording, ends the provider meeting, then marks the call `ENDED`, deletes its
  seats and, when nothing was recorded, its consent answers. If the provider fails, nothing in D1
  changes and the next step tries again; meanwhile no seat is claimed past `hardEndAt`.
- Every step is one conditional write: running it again changes nothing, and an ended or cancelled
  call never moves.

Every route runs it before acting on a live call. The every-minute cron that also runs it, and
reconciles seats with who is really in the room, is slice P4; `clock.test.ts` drives it with a
controlled clock. Starting recordings, with the spending guard, is slice P4 too: ending already stops
one.

## The API (`http.ts`, `calls.ts`)

| Route | Who | What |
|---|---|---|
| `POST /api/meetings` | a host of the channel | schedule a `SESSION` (cohort channel), a `CALL` (conversation; flag `meeting_checkins`) or an `EVENT` (community channel; flag `meeting_events`, with `record`); 201. Check-ins come from a suggested call (slice P10) |
| `GET /api/meetings/:id` | its channel's readers | the call, the server's `now` for the countdown, and the caller's `you`: `canJoin`, `canHost`, their seat and role |
| `POST /api/meetings/:id/join` | its channel's readers | a host opens a scheduled call; anyone takes a seat; returns the call, `provider` and this tab's `token`. 409 when it hasn't opened, has ended, or is full |
| `POST /api/meetings/:id/leave` | anyone with a seat | releases it; idempotent |
| `POST /api/meetings/:id/remove` | a host | removes a member (`{ userId }`), who can't rejoin; idempotent |
| `POST /api/meetings/:id/end` | a host | ends a live call for everyone, or cancels a scheduled one; idempotent |

Every answer is `Cache-Control: no-store`, the join's token above all. Every refusal is the same
404 with the same body: `meetings` (or the purpose's own flag) off for the caller, no session, a
personal access token of any scope (no scope covers taking a seat), a write from another origin, a
body naming anything the server decides (a role, a seat, a preset, a provider id, a recording
policy), a removed person joining again, and any call, channel or person the caller may not see. A
person who can see a call is told its state (409) and asked to agree to the code of conduct before
creating or joining one (403 `conduct_required`, as when posting). Admin rights come from the roles
table through `capabilitiesFor`, never from `locals.isAdmin`: these routes are outside `/admin`.

