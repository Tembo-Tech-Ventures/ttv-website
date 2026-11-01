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
space switcher still count notifications only. When mentor requests arrive
(`mentor_request`), a request addressed to a mentor is a real event and belongs
in attention.

Cost: for people with the Mentoring space, `getMe` adds two reads (roles, then
at most 50 rows); staging-fixture mentors add their per-row fixture checks. It
is not polled; it refreshes with each page. On the Confirm page the island's
own summary drops as the mentor saves, while the server-rendered sidebar badge
keeps the page-load number until the next navigation.
