# In-app calls

Video calls inside TTV: cohort sessions, check-ins and calls between two people, and community
events. The plan is in the SAM Library (`/plans/in-app-calls-2026-11-23/`: ARCHITECTURE, BUILD-PLAN,
UX-REVIEW); it is built one slice at a time, every slice dark behind the flags below.

What exists so far is the foundation: the tables, the flags (OFF), the values in the contracts and
the recording policy's channel rule (slice P3a, migration 0043); who may join, the provider interface
with a fake, the seats, the state machine and the API routes (slice P3b); scheduling cohort sessions
(slice P8); and the call room on the fake provider (slice P5, below). Every page and route is 404
while `meetings` is off. The real provider, RealtimeKit, and the every-minute clock arrive in slice
P4; its browser client in P6.

## Scheduling cohort sessions (slice P8)

Cohort sessions are scheduled from the cohort's Sessions page, by that cohort's instructors and TAs
or an admin (`meetingAccessFor`'s `canHost` on the cohort's main channel). Scheduling only writes
`meeting` rows: nothing is made at the provider until a host opens the room (P5, P6). While
`meetings` is off for the caller, the Sessions page is exactly what it was and every page and action
below is the same 404; so is everything for a person who doesn't host (or, for the calendar file,
see) the session, whatever the reason.

| Page | Who | What |
|---|---|---|
| `/dashboard/cohort/sessions` | the cohort's readers | "Coming up" above the recordings: each date still to come (and a live one), soonest first, with "Add to calendar"; hosts also get Edit and Cancel, and "Schedule a session" |
| `/dashboard/cohort/sessions/schedule` (`?cohort=`) | its hosts | the form: title, date, start in Nairobi time, length up to `CALL_LIMIT_MINUTES` in `SESSION_LENGTH_STEP_MINUTES` steps, just once or every week for 2 to `SESSION_SERIES_MAX_WEEKS` weeks. A series is previewed first, every date ticked; an unticked date is skipped. An admin chooses the cohort |
| `/dashboard/cohort/sessions/upcoming/:id` | its hosts | one date: change its title, time or length behind a confirm step, or cancel it (`?confirm=cancel`, a `ConfirmStep`). Only a date that hasn't opened changes |
| `/dashboard/cohort/sessions/upcoming/:id/calendar.ics` | its readers | the date's calendar file |

- **Plain forms.** Every page posts to itself and works without JavaScript (`session-form.ts` reads
  the fields; `sessions.ts` checks everything again: the host, every date still to come and within
  `SESSION_BOOK_AHEAD_DAYS`, the title, the length). A series is scheduled only from a preview of the
  same first date, time, length and weeks (`previewKey`), and only its own dates.
- **Separate dates.** A weekly series is one `meeting` per date sharing a `seriesId`; moving or
  cancelling one never changes the others. Always recorded (`ALWAYS`), with the call's limit.
- **Once per form.** The form carries its own token, made when it is first shown: the series id and
  the base of each date's id. The dates are written in one statement that writes none of them if any
  exists, so a form sent twice schedules once, and its note (nonce `session-scheduled-<token>`) posts
  once. Only "Schedule" schedules; "Preview dates" writes nothing.
- **One line in the channel.** Scheduling, moving and cancelling each post one line in the session's
  channel, by the host who acted, since there is no system author: "Scheduled 5 sessions: …" never a
  card per date (the card is P9). It goes through `postMessage` (the detectors, the code of conduct,
  the rate limits), then gets what a post through the channel API gets after the response
  (`note-checks.ts`): Clef's check, and the admins' queue notice when it was flagged or hidden. A note
  mentions nobody. Titles are put on one line. A refused note leaves the sessions as they are, and the
  host is told to tell the cohort.
- **Times.** Entered in Nairobi time; stored as the moment. Pages write Nairobi time with "EAT", and
  the browser adds the reader's own time where it differs (`local-time.ts`). No time zone is stored.
- **The calendar file** (`ics.ts`, RFC 5545): UTC times, so no VTIMEZONE; the call's id as its UID
  and a SEQUENCE that rises with each change, so adding a moved date again replaces the old entry.
  There are no email reminders.

## The room (slice P5)

`/dashboard/calls/:id` (`callPath`) is one call: the page before joining, the call, and the pages
after it, all in the `CallRoom` island (`components/calls/`) so the call keeps its media between
them. It takes the whole screen in the space's tone (`ImmersiveLayout`, as the post editor does), sits
outside the space router, and checks its own flag and access (`room.ts`, `resolveCallRoom`): anyone
the call isn't for gets the same 404. Its server read is one round trip beside the flags (the
channel, cohort, card, recording, hosts and the caller's conduct), then the call as the API reads it:
6 queries, 2 deep. "Coming up" on Sessions links to it, in its own tab, from
`ROOM_OPENS_EARLY_MINUTES` before a session starts.

**The boundary.** The island talks to the provider only through `RoomClient` (`room-client.ts`):
join with the join route's token and the person's media choices, leave (which releases every track
and subscription), microphone, camera, screen share, a host's mute and stop-share, a state stream
(the connection, everyone in the call with their tracks, the recording) and notices (muted or
stopped by a host, removed, ended, joined from another tab). `loadRoomClient(kind)` imports the
client for the token's provider when someone presses Join, so no SDK is in the island's chunk.
Removing someone and ending the call are TTV routes, never provider calls from a browser, and a
participant is known by their TTV user id; the page tells the island who hosts the call.

- `FakeRoomClient` (`fake-room-client.ts`) serves wherever the server's provider is the fake (local
  runs, tests, previews): the person's own camera, microphone and screen are real browser tracks, and
  who else is in the call comes from TTV's seats (`GET /api/meetings/:id/presence`, `fake-presence.ts`,
  which exists only on the fake provider and only for someone with a seat in the live call). Other
  people's media can't travel without a media server, so they show with no video. Its `simulate*`
  methods (and `window.__ttvFakeRoom`) drive what only a provider causes: a dropped connection, a
  failed recording, a host muting you.
- The RealtimeKit client is slice P6: it implements `RoomClient` with the Core SDK; its participants'
  custom ids must be TTV user ids (P4's `addParticipant`). Until then a `realtimekit` token can't
  connect, and the room gives the seat back and says so.

**Before joining** (`PreJoin.tsx`): the call's name, what is recorded (`recordingNotice`, before
Join, with "since 18:04 EAT" for someone late), Join (`Start session` for a host, held until
`ROOM_OPENS_EARLY_MINUTES` before the booked start; off for a member until a host opens it, the page
asking every `WAITING_POLL_MS` and saying when it opens), joining with the microphone or camera off,
or audio only for low data, and a device check with the browser's own camera and microphone
(`devices.ts`): a preview, a level, the device choices and a test sound, and for a blocked, missing
or busy device what happened and a way to join without it. A browser that can't make calls says so.

**In the call** (`Room.tsx`, `room-hooks.ts`): a shared screen first, with everyone in a strip under
it; otherwise everyone's tiles. One side panel, People (a host mutes, stops a share or removes a
member, after a `Dialog`) or Chat (a link to the call's thread, in a new tab); on a phone it covers
the stage. The controls are one toolbar (arrows, Home, End), each toggle named by what it will do,
and fixed at the bottom; on a phone their words are read but not shown. A phone that can't share a
screen says so when Share is pressed. A host's way out is a `Dialog`: End for everyone, Just leave
(only while another host is in) or Keep going. The room asks the server about the call every
`ROOM_POLL_MS` (its end, the caller's seat, the clock's offset); leaving the page asks first, and
gives the seat back if the person goes. Nothing in the browser ends a call: the server does.

**What is said** (the island's `LiveAnnouncer`, UX-REVIEW §5): the recording starting (to the host
who opened the room), stopping or failing, at once; a lost connection at once and its return
politely; people joining and leaving, gathered, politely, unless turned off in People; a host muting
you or stopping your share, at once; no host (at once, then at 1 minute, with a countdown);
the call's own 15-minute and 1-minute warnings (`Countdown`); and each page after a call (ended, with
why and where the recording will be; removed; full, with Try again; left; joined elsewhere), whose h1
takes focus.

**Not here yet:** recording consent and Stop recording for calls between two people (P11); the
session card, "live" in Attention and a follow-on session (P9); a knock to let late joiners in, which
UX-REVIEW §3 dropped (everyone who can reach the room may join).

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
| `GET /api/meetings/:id/presence` | someone with a seat in the live call | who holds a seat, for the fake room client only; 404 on any other provider (not a contract route) |

Every answer is `Cache-Control: no-store`, the join's token above all. Every refusal is the same
404 with the same body: `meetings` (or the purpose's own flag) off for the caller, no session, a
personal access token of any scope (no scope covers taking a seat), a write from another origin, a
body naming anything the server decides (a role, a seat, a preset, a provider id, a recording
policy), a removed person joining again, and any call, channel or person the caller may not see. A
person who can see a call is told its state (409) and asked to agree to the code of conduct before
creating or joining one (403 `conduct_required`, as when posting). Admin rights come from the roles
table through `capabilitiesFor`, never from `locals.isAdmin`: these routes are outside `/admin`.

