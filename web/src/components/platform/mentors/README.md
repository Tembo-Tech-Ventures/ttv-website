# Mentor connections (U-4.1 / S-4.1)

The pages people use to ask a mentor for time, and the pages mentors answer
from, over B-4.1 (`src/lib/mentoring`, see its README for the rules). They
exist only while `mentor_requests` is on for the person (effective only with
`channels`); otherwise the router and each page answer 404.

| Page | Space | What it does |
|---|---|---|
| `/dashboard/community/mentors` | Community | The directory (screen 05), its filters, the person's own requests with withdraw, and the "Ask for time" drawer |
| `/dashboard/mentoring/requests` | Mentoring | A mentor's queue (screen 06): accept, suggest another mentor, not this month (each with an optional note); this month's spots; "Worth another look" (B-4.2) when confirmed work has a newer revision |
| `/dashboard/mentoring/availability` | Mentoring | Headline, areas, formats, monthly spots, pause |
| `/dashboard/community/dm/[id]` | Community | A private conversation, headed by the other member (`getConversation`); one opened by a request starts with that request's context |

## How the pieces fit

- `server.ts` is the pages' one seam to the backend lane: page frontmatter
  reads through it, so everything renders without JavaScript from the same
  functions the API serves.
- The islands keep their state in `src/lib/platform/client` (S-4.1):
  `mentor-directory.ts` (filters held in the URL, `?ask=` for the open drawer),
  `mentor-request-form.ts` (the draft, kept per person and mentor in
  `sessionStorage` while the habits are agreed or the person signs in again),
  `mentor-requests.ts` (optimistic accept, redirect, decline and withdraw that
  roll back when the server refuses) and `mentor-availability.ts` (the editor's
  draft, dirty state and undo).
- `mentor-display.ts` holds the copy that depends on data: capacity in
  Africa/Nairobi months (always "2 of 3 spots open in November"), status lines
  and what a check means, "Full this month", and `AS_YOURSELF`.
- A card shows where the person already stands with that mentor
  (`MentorsDirectory`'s `standings`): a request still waiting replaces "Ask for
  time" with its status, and an accepted one offers its conversation beside it.
- Once the server has a mentor's answer, the queue asks the page's attention
  owner to count again (`requestAttentionRefresh`), so the bell and the
  Mentoring tab drop the answered request's notice at once.
- A refused send says the server's own sentence for a conflict or a limit
  (which request is in the way, or when the next spot opens), and fixed words
  otherwise; the note is always kept.

## Without JavaScript

Filters are links, and so is "Ask for time" (`?ask=`). The drawer named by `?ask=` renders as a plain panel with a
real form that posts to the directory page; `request-post.ts` hands the same
body to the API's own handler, so every gate is the API's. A send lands on
`?sent=<id>`; a refusal renders the drawer again on what was written, with the
reason.

## How we talk to each other, before Send

The note becomes the first message of a private conversation, so the person
agrees to the channels' habits before it is sent. The page reads whether they
have agreed to the current version; if not, the drawer shows the habits above
Send, the button reads "Agree and send request", and the form carries `agree`
with the version it showed. One press records the agreement, then sends the
same draft: with JavaScript the drawer posts the page's own conduct form
(`agree-conduct.ts`) and then calls the API, announcing each step; without, the
page records it and sends in the same post (`request-post.ts`). If the server
still asks (the words changed since the page was read), the drawer shows the
habits with the draft kept, and "I agree, send my request" sends it. An
agent's delegated session never agrees for the person.

## Who may ask

Any signed-in person, as themselves (owner decision 2026-11-02, "Mentor
requests are personal"): an organisation affiliation neither grants nor blocks
it. Someone with the INSTITUTION role reads one line saying so: "You can ask a
mentor for time as yourself. Requests come from you, not from your
organisation."

## Checks on a note (B-4.1)

A request whose note Tembo's check held, or that its mentor reported, carries `check`, and
`mentor-display.ts` shows that instead of its status, in the README's fixed words. The views never
name who raised it and never say "declined":
- **The person asking:** "Waiting for a check before it's sent" or "TTV is checking this request" (they can still
  withdraw), then "This request wasn't sent" or "This request was closed". Each comes with a fixed explanation
  and a next step (QA4-02): a check is routine, isn't a judgement on them, needs nothing from them, and ends
  with a notice (`mentor_checked`); once not sent or closed, they can ask again with a new note, with a link to
  how we talk to each other. The drawer and "Request sent" say a request can get a check before it reaches a mentor.
- **The mentor:** "Report this request" (with a reason) sits beside the three answers. A reported request then reads
  "Reported", with nothing to press. It leaves the waiting count and the month's spots, as an open check holds none.
- **Admins** keep or remove these on `/admin/moderation?tab=request-notes`
  (`src/components/admin/moderation/request-notes.ts`, through the API's own handler, so a keep also tells the mentor).

## Tests

- Unit: `mentor-display.test.ts`, `mentors-ui.test.tsx`, `request-post.test.ts`,
  and the client stores' tests beside them.
- `e2e/platform-mentors.spec.ts`: the DEV harness `/dev/platform-mentors`
  (stateful mock) at 390 and 1440, axe, keyboard, rollback, no-JS drawer, the
  habits before Send, an organisation account asking as itself, flag off.
- `e2e/platform-mentor-requests.spec.ts`: the same journeys against the real
  backend with the local persona seed: request → accept → conversation,
  withdraw, not this month with a note, a suggestion, a full mentor, and an
  organisation account asking as itself.
- `e2e/platform-mentor-request-notes.spec.ts`: checks against the real backend, both ways: a Tembo-held note
  (seeded) that an admin removes, and a reported one an admin keeps.
