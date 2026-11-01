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
