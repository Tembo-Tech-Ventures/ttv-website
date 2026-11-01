# Onboarding: welcome and request steps (U-O.1)

`/dashboard/welcome` asks a person how they will take part (S1) and, when they
chose mentoring or finding people for an organisation, what the team needs to
decide on their request (S2). Library `/reports/platform-onboarding-2026-11-01/`
holds the spec (SPEC.md §2) and the screens this implements (`01`, `02`).

Choosing never grants anything. Intents only choose where a person starts and
which words they see; mentor and organisation access stay requests that a TTV
administrator decides, and the page says so before anything is sent.

## How it is built

- `welcome-flow.ts` is the whole flow, on the server: `handleWelcome(request,
  routes, actions)` reads a GET or a form POST and answers with a redirect or
  the step to render. Every POST redirects on success (post, redirect, get),
  so a reload never sends anything twice, and re-renders with what was typed
  on failure. The next step is chosen from the state the server returns, never
  from what the form asked for.
- Order matters: S1 always saves intents, which completes onboarding, before
  S2 can send a request. Only saving intents moves an account from NEW to
  DONE, and B-O.4 keeps sending a NEW account to the welcome step, so S2 is
  unreachable until the person has chosen (`server-actions.test.ts`).
- `WelcomeScreen.astro` renders a step inside `OnboardingFrame.astro`: the top
  bar (brand and account menu, no space tabs) and the welcome sheet resting on
  a complete Community sheet, the card file the person is about to enter.
- Focus: each step's h1 is rendered with `autofocus`; after a rejected post
  the problem (S1) or the list of problems (S2) has it instead, so focus is
  right before and without JavaScript.
- Both forms are plain HTML forms that work without JavaScript. The islands
  (`WelcomeChoices`, `AccessRequestForm`) are server-rendered and add only what
  needs a script: the selection count, checking a choice before posting, the
  note counters and protection against a second press.
- The page (`src/pages/dashboard/welcome.astro`) passes the real onboarding
  server functions. The DEV harness (`/dev/platform-onboarding`) passes
  in-memory fixture actions (`harness/fixture-actions.ts`) for the fixture
  personas, with `fail=rate|save|conflict` for the failure states.
- The page is invisible unless `onboardingOpen(me.flags)`: the `spaces` shell
  and the `onboarding` flag are both on.

## Motion brief (ttv-ui-motion)

**Feeling.** Calm and tactile: choosing which cards to take from the file
before stepping into it. Nothing performs; the page waits for the person.

**Focal subject.** The choice card under the person's hand. Choosing it lifts
it a few pixels off the sheet as its peach edge draws in and the check settles
into its box, the way a card is drawn up out of a file. The edge leads; the
check lands a beat after it, so the card reads as taken before it reads as
ticked. Under 180 ms. Nothing else on the sheet moves, and un-choosing simply
lets the card back down.

**Steps.** Continue is navigation, so it uses the space-switch grammar the shell
already taught: the welcome sheet stays where it is and dims as it falls behind,
and the next sheet (the request step, or the space you land in) rises over it
from just below and settles. Under 300 ms. The top bar does not move; it is the
anchor. The rear Community sheet is part of the page, not of the gesture.

**Resting composition.** One Mattone heading, the lead, three equal cards in a
row on wide screens (a stack on phones, with the actions in a bar that stays
reachable at the bottom), and the access note directly under the cards.

**Touch and reduced motion.** Touch uses the same lift, without the hover
preview. With reduced motion the state changes at once and steps are a plain
cut: no lift animation, no sheet transition. Focus lands on the step's heading
(or on the list of problems after a rejected form) on every page.

**Rejection criteria.** Reject it if the cards bounce, stagger in, or move on
page load; if choosing reads as decoration rather than selection (the ticked
state must be readable in a still frame); if any card's edge crosses its
neighbour; or if focus is lost across a step.

# Intent-aware framing (U-O.2)

What onboarding changes on the pages people land on (SPEC §2 S3–S5, §3; screens
`03`–`05` and `07`). Intents choose words and order only. Every card that says
something about access follows the request and the role held, never the
intent alone.

- `framing.ts` reads `getOnboardingState` into an `OnboardingView`: the Community
  framing (`member`, `exploring` or `partner`), the status cards, the one-time
  card for older accounts, the granted roles for "Your spaces", and the pending
  requests for the sidebar. Inferred intents apply only while nothing is saved.
- `spaces/space-page.ts` (`loadOnboarding`) loads it into the spaces context for
  the landing pages (Cohort, Community, Mentoring, Discover), Account and every
  Community page. It is null, and nothing changes, while the `onboarding` flag
  is off for the person, for restricted staging identities, for personal access
  tokens and for agents' delegated sessions. A failed read is recorded and the
  page keeps the framing it had before onboarding.
- `OnboardingNotices.astro` sits at the top of a landing page: the one-time card
  (`ExistingAccountCard.astro`, S4), the status cards (`StatusCard.astro`, S3)
  and, in Community, the welcome for someone just looking around and the
  "Your spaces" line. An approval is announced everywhere but in the space it
  opened, since opening that space marks it seen.
- Community: `partner` (chose to mentor or find people, and not to build and
  learn) drops the cohort invitation and "Apply to a cohort", and names the
  journey "Your own work"; `exploring` keeps the invitation and replaces the
  first-contribution prompt with the welcome. The sidebar lists pending
  requests under "Your requests", each opening Account: a request is never a tab.
- `TakingPart.astro` is Account → "How you take part" (S5): the Build and learn
  switch, and one state per access (Not requested, Pending, Not approved,
  Active) with the one thing that can be done about it.
- `account-actions.ts`: every form above is a plain form posting to Account,
  which answers with a redirect back to the page it came from (a fixed list,
  never an arbitrary URL), so all of it works without JavaScript. Asking for
  access goes on to the request step, narrowed with `?role=` to that access
  alone; the request step is what an administrator decides.
- No analytics: nothing here records or counts choices.

# After the onboarding QA (F-6)

What changed after the fresh-tester QA at `7e749c5` (library
`/qa/onboarding/7e749c5…/REPORT.md`, findings QAO-01 to QAO-11):

- A pending card says the decision "will appear here", and nothing else:
  Attention is not named until a decision exists. Attention's Requests tab
  holds requests for a mentor's time; with onboarding on, its empty line says
  so and points to Account for the person's own access requests (QAO-01).
- After a request is sent, the flow lands on Community (`routes.sent`), never
  on whatever `/dashboard` and the last-space cookie pick, with `?sent=` naming
  the roles. `OnboardingNotices` then says "Request sent." as a focused status,
  but only for roles whose request is still pending (QAO-02, QAO-05).
- "View request" and the sidebar's "Your requests" open the request's own row
  in Account (`requestRowId`), which shows what was sent (`SentRequest.astro`):
  the person's own fields, never the administrator or the team's words (QAO-03).
- The notes' 20 to 600 character rule is a visible hint (QAO-04).
- Notices and the cohort invitation sit above a page's h1, so their titles
  name their regions instead of being headings (QAO-05).
- Names that add context to a visible label are one `aria-label` string, never
  a visually hidden span: Chrome reads an absolutely positioned span with a
  space before its punctuation (QAO-09).
- Saving or hiding the one-time card returns with `?onboarding=saved|hidden`,
  and the page says so, focused, once the card is gone (QAO-10).
- The public profile reads onboarding too: someone framed as a partner (chose
  to mentor or find people, not to build and learn) gets a note that public
  builder profiles come with a cohort, not a lock and "Browse Programs" (QAO-07).
