# Mentoring

## Shared work waiting for confirmation (F-2, QA1-06)

`awaitingConfirmation({ db, env, locals })` returns how many contributions on
the Confirm page still have no confirmation from this mentor at their current
revision. `getMe` sends it as `Me.mentoring.awaitingConfirmation`, only to
people with the Mentoring space. The Mentoring overview, the Confirm work
sidebar badge and the attention panel read that one number.

**Same authorization as the Confirm page.** The count reads the rows
`GET /api/community/mentorship` lists, through the same code:
`createCommunityService(...).countAwaitingConfirmation()` and `listMentorship()`
share one query (`mentorshipRows`): MENTOR or ADMIN roles from the database,
contributions shared beyond their author (`visibility='institution'`), never
the mentor's own, the 50 newest, and the demo and staging-fixture scopes. The
caller is built by the route's own `communityActor(locals)` and passes the
route's `requireBrowser` gate, so personal access tokens and delegated agent
sessions get no number, except the synthetic mentor personas the route also
serves. Retained QA personas reach the Confirm page through a separate
filtered handler, which the count does not reproduce, so they get none either.
`awaiting.test.ts` checks each kind of caller against the route itself.

Null, not zero, means "not known", and pages then never say nothing is
waiting. It is returned for a caller the Confirm page refuses; for a failed
read, which is recorded as a warning so a badge never takes the spaces shell
down with it; and when the Confirm page's 50-row window is full with none of
it waiting, since older work beyond the window might be. With work in the
window the number is what the Confirm page shows, a floor rather than a total.

**Set-aside work is not waiting.** A contribution the mentor set aside at its
current revision (below) is not counted, and the Confirm page lists it apart.

## Private set-aside (F-7, QA1R-02)

Owner decision, 2026-11-01 ("Mentors can privately set aside work they can't
confirm"): without it the only way to clear the waiting count was to confirm.

- On the spaces Confirm page, each contribution waiting for this mentor has
  "Set aside: I can't confirm this". It leaves their waiting count and list
  and moves to a "Set aside (n)" list where they can undo it. The page says
  "You've set this aside. The member isn't told."
- `POST /api/community/journey/:id/set-aside` with `{ expectedRevision }`
  records it (201, `{ setAside: { journeyId, journeyVersion, setAside: true } }`);
  `DELETE` on the same path undoes it for every revision (200). Repeating
  either is harmless.
- Same rules as confirming: MENTOR or ADMIN roles from the database, shared
  work by someone else, the revision the mentor saw (409 when it changed or
  they already confirmed it), the demo and staging-fixture scopes, a
  same-origin write, and `requireBrowser`, so personal access tokens and
  delegated agent sessions are refused. Retained QA personas cannot write it.
- One row per mentor and revision in `communitySetAside` (migration 0027),
  removed with the mentor or the contribution. A new revision, including
  unpublishing and sharing again, is not covered by an old row, so the work
  waits again, as revision-bound confirmations do.

**Private by construction.** Only `mentorshipRows` reads the table, for the
calling mentor, so only their own `GET /api/community/mentorship` and
`Me.mentoring.awaitingConfirmation` change. The member's journey, other
mentors' lists, institutional profiles, search, discovery, the evidence
assessment, chat and MCP read other tables and show nothing. There is no
attention item, rating, flag or note: missing evidence is not evidence
against anyone. `src/lib/community/set-aside.test.ts` checks every one of
those reads before and after, and fails if new code starts reading the table.
Admin operational counts are not built; add them only if operations need them,
and never for members or institutions.

**Spaces only.** The routes return 404 while `spaces` is off for the caller,
and the action is offered only inside the spaces shell. The legacy Confirm page
says its list "is not a queue of review requests" and shows no waiting count,
so there is nothing for a set-aside to clear there.

**Why this is not attention.** Mission contract B-1.3 allows attention only
from real existing events with a real recipient, and forbids inventing a
matching domain. Nothing in the data records "shared with this mentor":

- sharing is a visibility flag on `communityJourney`, addressed to every mentor
  and institution at once, with no recipient and no event row;
- `communityConfirmation` records what a mentor did, not what was asked of
  them;
- attention items are per-recipient events with read state. Writing one for
  every mentor whenever anyone shares would be the broadcast the
  `opportunity_match` decision ruled out, would need a backfill for work
  already shared (the attention producers have none), and marking it read
  would hide work that still waits.

So the number is derived on each page load from the rows themselves and lives
on the Mentoring space, outside attention. The attention unread counts and the
space switcher still count notifications only. A mentor request, addressed to
one mentor, is a real event and does reach attention (below).

Cost: for people with the Mentoring space, `getMe` adds two reads (roles, then
at most 50 rows); staging-fixture mentors add their per-row fixture checks. It
is not polled; it refreshes with each page. On the Confirm page the island's
own summary drops as the mentor saves, while the server-rendered sidebar badge
keeps the page-load number until the next navigation.

## Mentor connections (B-4.1)

Members ask mentors they are not yet connected with for time, with their work
attached; a mentor accepts, suggests someone better placed, or says "not this
month". Plan: SAM idea 01M68GQAP1DCSVMRJMZS771ZRB, §3 and Phase 4; design:
`/reports/platform-ux-2026-10-30/` screens 05 and 06. Wire contracts are the
`Mentor*` schemas in `src/lib/platform/contracts.ts`. Shipped dark behind
`mentor_requests`, which is effective only while `channels` is on
(`src/lib/platform/server/flags.ts`), because accepting opens a conversation.

### Data (migration `0036_mentor_requests.sql`)

| Table | Holds |
|---|---|
| `mentor_profile` | One row per mentor, written only by themselves: headline, bio, areas, the formats they offer, monthly capacity (0–20), paused |
| `mentor_request` | Asking a mentor for time: requester, mentor, format, note, the detectors' reasons on the note, the attached project (a snapshot with its `journeyId` and revision), and once answered the conversation it opened, the suggested mentor or the mentor's note |

The database enforces the state machine's shape: exactly one PENDING request
per pair (`mentor_request_pending_idx`); `acceptedAt` and `channelId` exactly
when ACCEPTED; `decidedAt` exactly when no longer PENDING; a suggested mentor
only on REDIRECTED, a mentor's note only on REDIRECTED or DECLINED; nobody asks
themselves. Deleting a person removes their profile and every request they made
or received; a suggested mentor's deletion leaves the redirect without a target
(`redirectedTo: null`); deleted work leaves its snapshot, shown as unavailable.
A conversation cannot be deleted while a request points at it.

### Availability and the directory (`profiles.ts`)

- `GET`/`PUT /api/mentoring/availability`: the caller's own, MENTOR role only
  (403 otherwise, checked inside the write). Before the first save: an empty
  headline, no areas, every format, capacity 0, `listed: false`.
- **Listed** means the MENTOR role from the database, a saved profile, not
  paused, and a capacity above zero. A revoked role unlists at once; the
  profile stays for if it comes back. Elevated roles grant nothing else here:
  being listed is not talent-directory eligibility.
- `GET /api/mentors?area&format&available`: listed mentors other than the
  caller, those with a spot first, then by name, at most 100, with every
  filter applied before the limit. Every signed-in
  person sees it, institutions included, like the community. Public fields
  only: the person with global badges (never cohorts), headline, areas,
  formats, bio and capacity. `area` matches one of a mentor's areas ignoring
  ASCII case; `available=true` keeps those with a spot open now. One statement.

### Capacity (`capacity.ts`)

A month is the calendar month in Africa/Nairobi (UTC+3, no daylight saving),
so it turns at 21:00 UTC on the last day. Each PENDING request to a mentor and
each request they accepted this month holds a spot; `used` counts both. A new
request needs a free spot (409 when full). Declining, redirecting and
withdrawing free a spot at once; accepting needs none of its own (the pending
request already held one), so lowering capacity refuses nobody already
waiting. When full, `nextOpeningAt` is the next month's start if the turn of
the month frees a spot (the pending requests alone leave room), and null
otherwise: it waits on the mentor answering.

### Requests (`requests.ts`)

| Route | Who | Does |
|---|---|---|
| `POST /api/mentor-requests` | Any signed-in person, institutions included | Asks a listed mentor, in a format they offer, with their own published project at its current revision or nothing |
| `GET /api/mentor-requests?as=requester\|mentor&status&cursor` | Anyone | The requests the caller sent or received, newest first, 20 a page |
| `GET /api/mentor-requests/:id` | Its two parties | One request |
| `POST …/:id/accept` | The mentor, still holding the MENTOR role | Opens the conversation (below) |
| `POST …/:id/redirect` `{ mentorId, note? }` | The mentor | Suggests another listed mentor (not themselves, not the asker); the asker decides whether to ask them, and nothing reaches the suggested mentor |
| `POST …/:id/decline` `{ note? }` | The mentor | "Not this month"; it counts against nobody |
| `POST …/:id/withdraw` | The person asking | Takes the request back |

- Only the two parties see a request; anyone else, admins included, gets the
  same 404 as for a missing one. The wrong party gets 403; a request that is
  no longer PENDING gets 409, whichever move is tried: the end states are final.
- Asking refuses, in this order: asking yourself (400); attached work that
  cannot be shared, with the channel embeds' rules (400, or 409 for a stale
  revision); a mentor who is not listed (404) or does not offer the format
  (400); no current agreement to the code of conduct (403 `conduct_required`,
  because the note becomes a message); a PENDING request to the same mentor
  already (409); 5 requests waiting at once, or 10 made in a rolling day (429,
  the second with `retryAfterMs`); no spot left (409). Each condition is
  checked inside the INSERT, so concurrent requests cannot both pass.
- The note is screened by the channel detectors when it is written. The mentor
  sees contact details in it masked, as a channel reader would; the asker
  sees it whole. The mentor's reply on a redirect or decline is screened the
  same way on each read: the asker sees its contact details masked, the
  mentor sees it whole. A pending note gets no Clef check and cannot be
  reported yet; the conversation it opens can be. Attached work is checked again on every read (still the
  asker's, still published) and becomes `{ type: "unavailable" }` otherwise.
- The mentor sees the asker's cohort and alumni badges as context for the
  request; the asker sees only the mentor's global badges.
- **Accepting** opens the DIRECT conversation the two already share, or a new
  one with the two of them as its only members, named for the other person
  in each member's channel list. The note becomes the asker's first message
  there, with the work attached at the requested revision (even if the asker
  has moved it on since), screened as a post is: flagged contact details stay
  visible to the asker and masked for the mentor, and Clef checks it after the
  response. The conversation, its members, the request and the message commit
  in one batch. Its nonce, `mentor-request-<id>`, makes it one message per
  request. From there the conversation is an ordinary DIRECT channel
  (`src/lib/channels/README.md`): the channel APIs, the code of conduct,
  detectors, masking, Tembo's DIRECT scope ("this conversation only"),
  mentions, and search for its members. Its page is routed at
  `/dashboard/community/dm/<id>`; the page itself is U-4.1's to build.
- Two people asking each other at the same moment, each accepted at once, can
  end up with two conversations; later acceptances reuse the oldest. Rare
  (it needs two mentors asking each other), and both stay readable to the two
  of them only.

Gates (`http.ts`): every route is 404 `flag_off` while `mentor_requests` is
off for the caller, before any mentoring data is read. Browser and agent
sessions only: every personal access token is refused (403), channels and
admin scopes included, since no token scope covers asking a person for their
time. Writes need the same origin. Statement budget, asserted in
`http.test.ts`: one statement for each read; two for asking and for saving
availability; three for redirect, decline and withdraw; accept is a read, a
pair lookup, one batch of at most five writes, and two reads back.

### Attention (`src/lib/attention/mentor-producers.ts`)

After each move's response, the other party hears once: a new request tells
the mentor (`mentor_request`, in Mentoring, at the Requests page); accepting
tells the asker (`mentor_accepted`, in Community, at the conversation);
redirecting and declining tell the asker (`mentor_redirected`,
`mentor_declined`, at the directory); withdrawing tells the mentor
(`mentor_withdrawn`). An item is written only while the request is still in
the state its move left it in, so a request answered before its notice was
written leaves no stale notice. It needs `spaces`, `channels` and
`mentor_requests` for the recipient, and never copies the note or the
mentor's reply. The attention panel lists each notice only to the party it
was for (`src/lib/attention/access.ts`).

### Pages

`/dashboard/community/mentors`, `/dashboard/mentoring/requests` and
`/dashboard/mentoring/availability` are routed only while `mentor_requests` is
on for the caller (`space-routes.ts`, `space-routing.ts`); Mentoring pages need
the Mentoring space as usual. Restricted staging identities do not get them.
The page files, and the conversation page, come with U-4.1: until then these
routes reach Astro's 404, so `mentor_requests` stays OFF on shared environments
until they ship.
