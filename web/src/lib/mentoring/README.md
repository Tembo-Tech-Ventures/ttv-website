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
| `POST /api/mentor-requests` | Any signed-in person, as themselves | Asks a listed mentor, in a format they offer, with their own published project at its current revision or nothing |
| `GET /api/mentor-requests?as=requester\|mentor&status&cursor` | Anyone | The requests the caller sent or received, newest first, 20 a page |
| `GET /api/mentor-requests/:id` | Its two parties | One request |
| `POST …/:id/accept` | The mentor, still holding the MENTOR role | Opens the conversation (below) |
| `POST …/:id/redirect` `{ mentorId, note? }` | The mentor | Suggests another listed mentor (not themselves, not the asker); the asker decides whether to ask them, and nothing reaches the suggested mentor |
| `POST …/:id/decline` `{ note? }` | The mentor | "Not this month"; it counts against nobody |
| `POST …/:id/withdraw` | The person asking | Takes the request back |

- Only the two parties see a request; anyone else, admins included, gets the
  same 404 as for a missing one. The wrong party gets 403; a request that is
  no longer PENDING gets 409, whichever move is tried: the end states are final.
- **Who may ask** (owner decision, Raph, 2026-11-02, policy "Mentor requests
  are personal"): any signed-in person, as themselves: a cohort member, an
  alumna or alumnus, or a signed-in member of the public. Belonging to an
  institution neither grants it nor blocks it, and no account asks on an
  institution's behalf. The code of conduct, the mentor's capacity and the
  checks below still apply. This replaces #304's interim rule (a community
  profile or a cohort place).
- Asking refuses, in this order: asking yourself (400); attached work that
  cannot be shared, with the channel embeds' rules (400, or 409 for a stale
  revision); a mentor who is not listed (404) or does not offer the format
  (400); no current agreement to the code of conduct (403 `conduct_required`,
  because the note becomes a message); a PENDING request to the same mentor
  already (409, saying which: waiting with the mentor, waiting for a check
  before it's sent, or being checked by TTV, never who opened the check,
  QA4-11); 5 requests waiting at once, or 10 made in a rolling day (429,
  the second with `retryAfterMs`); no spot left (409, naming the next
  opening, with `retryAfterMs` until then, when the turn of the month frees
  one, QA4-20). Each condition is checked inside the INSERT, so concurrent
  requests cannot both pass.
- The note is screened by the channel detectors when it is written. The mentor
  sees contact details in it masked, as a channel reader would; the asker
  sees it whole. The mentor's reply on a redirect or decline is screened the
  same way on each read: the asker sees its contact details masked, the
  mentor sees it whole. Clef checks the note after the response, and the
  mentor may report it (Checks, below). In the conversation it opens, either
  member reports a message, and only that message reaches the admins
  (`src/lib/channels/README.md`, "Direct conversations"). Attached work is checked again on every read (still the
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

### Checks (`checks.ts`, migration `0037_mentor_request_checks.sql`)

A request's note is screened like a channel post. When the request is
written, the detectors mask contact details for everyone but its author
(`noteReasons`). After the response, Clef flash reads the note as a direct
conversation's message (`clefHold`). Near-certain abuse (the channel hide
threshold) opens a check, and the check **holds** the request:

- The mentor doesn't see it. They aren't told, it isn't in their list, and it
  is 404 to them, like a missing request.
- It uses no spot of the mentor's capacity (`HELD` in `visibility.ts`,
  applied in `capacity.ts`).
- The person asking sees it PENDING with `check: "waiting"`. The UI copy is
  "Waiting for a check before it's sent", never "declined". They may still
  withdraw it. A withdrawn Clef hold is moot (the mentor never saw it): it
  leaves the OPEN queue and the admins' notices, and deciding it is 409.

Anything short of near-certain abuse changes nothing. Clef runs after the
response, as for channel posts, so in the moment before it answers the mentor
can already list the request. When the mentor's report opened a check first,
Clef's reasons join it, and the mentor gets no "new request" notice for a
request they reported. When Clef fails or is not
configured, the request stays as it is, the failure is logged without the note,
and the mentor is told as usual (fail open). The attached project is not sent
to Clef: it is the asker's own published work, which its own check covers.

The mentor may **report** a waiting request (`POST
/api/mentor-requests/:id/report`, `{ reason }`):

- Only the mentor may report: the person asking gets 403, anyone else 404.
- Only while the request is PENDING (409 after). One report per request (409).
- Reporting closes the request for the mentor. It stays in their list with
  `check: "reported"`, and accepting, redirecting or declining it is 409. It
  holds no spot.
- The report opens a check. The person asking sees `check: "checking"`
  ("TTV is checking this request"): the mentor has read it, so "before it's
  sent" would be false. It never names who opened the check. Withdrawing never
  hides a report: the check stays in the OPEN queue (with the request's
  status) and in the admins' notices until an admin decides it, for the
  record.

| Table | Holds |
|---|---|
| `mentor_request_case` | At most one per request: OPEN or DECIDED, Clef's reasons when Clef held it, when it last opened, and the latest decision (KEEP or REMOVE, the reason, the admin, when) |
| `mentor_request_report` | The mentor's report: one per request, with their reason |

Admins decide in their own queue. It is separate from the channel
`moderation_case` queue, whose contract is unchanged.

- `GET /api/moderation/mentor-requests?state=OPEN|DECIDED&cursor=`: oldest
  opened first, 20 a page, one statement along `mentor_request_case_queue_idx`.
  Each item has the request with its note as written, Clef's reasons, the
  report and the latest decision.
- `POST /api/moderation/mentor-requests/:id`, `{ action: "keep" | "remove",
  reason }`:
  - **keep** releases the request to its mentor as it is (PENDING), and the
    mentor is told once, if they had not been. It holds a spot again, even if
    the mentor filled their month meanwhile.
  - **remove** closes a waiting request as WITHDRAWN with the reason recorded.
    The person asking sees `check: "not_sent"` ("This request wasn't sent")
    when the mentor never saw it, or `check: "closed"` ("This request was
    closed") when they had, and may ask again. A mentor who never saw it
    never does.
  - It is 404 for a request with no check; 403 for an admin who is one of the
    request's two parties (nobody judges their own request); 409 once the
    check is decided, or for a Clef hold whose request was withdrawn. A
    removal closes the request only if it still waits (`closedRequest`), so
    one the asker withdrew first stays theirs, with no check shown.

A report on a request an admin kept opens its check again, showing the earlier
decision until the next one. Both admin routes are for admins only (403), and
follow the gates below: flag, browser sessions only, same origin for the
decision. Each check that opens tells every admin except the request's two
parties, once per opening (`moderation_pending`, admin space, at
`/admin/moderation?tab=request-notes`). The notice shows while the check is
open. U-4.1 builds that "Request notes" tab.

- **Finding them** (QA4-04): `countOpenChecks(db, viewerId)` counts the open
  checks this admin may decide, as the OPEN queue lists them, for the tab,
  the Admin sidebar badge and Admin Home (0 if the read fails). The queue and
  the count leave out an admin's own requests: another admin decides them,
  and listing them would show the admin who opened the check.
- **What a keep costs** (QA4-10): each check carries `mentorCapacity`, the
  mentor's spots this Nairobi month now (null without saved availability), so
  the admin sees that a keep takes one of them, even past full.
- **What the person asking hears** (QA4-02, owner rule: Clef may hold an
  item for a human, with a fixed explanation shown): a `mentor_checked`
  notice for each change a check makes to their request, at the directory:
  it waits for a check, TTV is checking it, it was checked and sent, or it
  wasn't sent or was closed and they may ask again. The words are fixed, the
  same whoever opened the check, and never "declined". A decision on a
  request they had already withdrawn tells them nothing.

### Attention (`src/lib/attention/mentor-producers.ts`)

After each move's response, the other party hears once: a new request tells
the mentor (`mentor_request`, in Mentoring, at the Requests page); accepting
tells the asker (`mentor_accepted`, in Community, at the conversation);
redirecting and declining tell the asker (`mentor_redirected`,
`mentor_declined`, at the directory); withdrawing tells the mentor
(`mentor_withdrawn`). The mentor hears only of requests they may see
(`MENTOR_SEES`): a request Clef holds reaches them only once an admin keeps it.
A new request's notice shows only while it still waits for their answer, so
answering clears it from their panel, badge and bell (QA4-07). An item is written only while the request is still in
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

## Worth another look (B-4.2)

`GET /api/mentoring/another-look` (`another-look.ts`) lists shared work the
caller confirmed at an earlier revision that has a newer revision, so their
confirmation no longer covers the current one (screen 06, "Worth another
look"): each item has the work, its owner (name and avatar, no badges), the
latest revision the caller confirmed and the current one, and a link to the
Confirm page, where the current revision waits for them. Only work that page
shows is listed (the service's `confirmWindow`: its 50 newest shared
contributions), so every item can be confirmed or set aside where its link
goes. Newest change first, at most 20.

It reads through the Confirm page's own service
(`createCommunityService(...).listWorthAnotherLook()`), so the same checks
apply: the browser gate (`requireBrowser`: no personal access tokens, no
delegated agent sessions except the synthetic mentor personas), MENTOR or
ADMIN roles from the database (403 otherwise), someone else's shared work
only, and the demo and staging-fixture scopes. Work the caller has confirmed
or set aside at the current revision is not listed; a set-aside at an older
revision does not hide a newer one. The route is 404 while `mentor_requests`
is off for the caller. It is derived on each read, not attention, for the
reasons given under "Why this is not attention" above. Cost: the role read,
then one statement over the caller's confirmations (`communityConfirmation`
has no mentor index; a mentor's confirmations are few, and the page is not
polled).
