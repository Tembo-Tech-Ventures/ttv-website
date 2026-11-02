# Mentor connections (U-4.1 / S-4.1)

The pages people use to ask a mentor for time, and the pages mentors answer
from, over B-4.1 (`src/lib/mentoring`, see its README for the rules). They
exist only while `mentor_requests` is on for the person (effective only with
`channels`); otherwise the router and each page answer 404.

| Page | Space | What it does |
|---|---|---|
| `/dashboard/community/mentors` | Community | The directory (screen 05), its filters, the person's own requests with withdraw, and the "Ask for time" drawer |
| `/dashboard/mentoring/requests` | Mentoring | A mentor's queue (screen 06): accept, suggest another mentor, not this month; this month's spots |
| `/dashboard/mentoring/availability` | Mentoring | Headline, areas, formats, monthly spots, pause |
| `/dashboard/community/dm/[id]` | Community | A private conversation; one opened by a request starts with that request's context |

## How the pieces fit

- `server.ts` is the pages' one seam to the backend lane: page frontmatter
  reads through it, so everything renders without JavaScript from the same
  functions the API serves. `canAsk()` is the API's own member check
  (`IS_MEMBER`), so the directory and `POST /api/mentor-requests` agree.
- The islands keep their state in `src/lib/platform/client` (S-4.1):
  `mentor-directory.ts` (filters held in the URL, `?ask=` for the open drawer),
  `mentor-request-form.ts` (the draft, kept per person and mentor in
  `sessionStorage` while the habits are agreed or the person signs in again),
  `mentor-requests.ts` (optimistic accept, redirect, decline and withdraw that
  roll back when the server refuses) and `mentor-availability.ts` (the editor's
  draft, dirty state and undo).
- `mentor-display.ts` holds the copy that depends on data: capacity in
  Africa/Nairobi months, status lines, "Full this month", and `NEEDS_MEMBER`.

## Without JavaScript

Filters are links. The drawer named by `?ask=` renders as a plain panel with a
real form that posts to the directory page; `request-post.ts` hands the same
body to the API's own handler, so every gate is the API's. A send lands on
`?sent=<id>`; a refusal renders the drawer again on what was written, with the
reason. Agreeing to how we talk to each other posts to the same page and comes
back with the drawer open.

## Who may ask

A member account: a community profile or a cohort place (B-4.1, #304). Anyone
else, such as an institution-only account, still reads the directory, sees no
"Ask for time" buttons, and reads one neutral line: "Asking a mentor for time
needs a member profile or a cohort place." It does not send anyone to make a
profile, because a saved profile is discoverable to institutions.

## Tests

- Unit: `mentor-display.test.ts`, `mentors-ui.test.tsx`, `request-post.test.ts`,
  and the client stores' tests beside them.
- `e2e/platform-mentors.spec.ts`: the DEV harness `/dev/platform-mentors`
  (stateful mock) at 390 and 1440, axe, keyboard, rollback, no-JS drawer, an
  account that cannot ask, flag off.
- `e2e/platform-mentor-requests.spec.ts`: the same journeys against the real
  backend with the local persona seed: request → accept → conversation,
  withdraw, not this month, a suggestion, a full mentor, and an
  institution-only refusal.
