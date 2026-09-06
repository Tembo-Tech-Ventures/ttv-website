# UX simplification review

Reviewed 2026-09-06 against `main` at `048bd95`. Two independent reviews ran
in parallel on the same brief (branches `sam/feel-things-system-overly-zv9jd2`
and `sam/feel-things-system-overly-bqp1xa`); this document merges them. Both
read every route and drove the real app on a seeded local database at 1280 px
and on a Pixel 7 profile. Where they disagreed, section 11 states the
resolution. Every finding cites a file and line; paths are relative to
`web/` unless they start with `docs/`. "Verified in browser" means the screen
was rendered locally and inspected; a few claims carried over from the second
review are marked "not re-verified".

Scope: 44 page routes (23 admin, 13 member, 8 public), 14 API routes, 8
dev-only routes, 27 tables, both shells, the middleware, and the e2e journeys
that document intent.

## 1. The short version

The site is no longer one product. It is seven, stapled together: a marketing
site, an applications workflow, session recordings with AI chat, a talent
directory with a hiring funnel, a blog, an admin console, and an automation
access layer. Each arrived as one batch (talent platform in PRs #63 to #68,
admin platform in #73, recordings and credentials in #75 and #76, tokens in
#83, chat in #102 and #109, blog in #117), each batch brought its own nav
entries, status vocabulary, form pattern, safety machinery and copy, and
nothing was consolidated across batches. Everything was sized for a scale TTV
does not have: about a dozen users, two cohorts, one to three admins.

The individual pages are mostly fine. Six decisions compound:

1. **One navigation for every state.** The member shell shows the same ten
   links to everyone (`src/components/shells/DashboardShell.tsx:21-32`). For a
   person who just signed in, six of the ten lead to a lock, an empty state,
   or a canned answer. Instructors and TAs get student copy everywhere. The
   admin sidebar is a flat list of up to thirteen. Verified in browser.
2. **The most important flow is the thinnest.** "Apply" is one button that
   stores `{}` (`src/lib/admin/program-application.ts:110`); the applicant is
   then invited to edit their application as raw JSON
   (`src/pages/dashboard/application/[id].astro:146-165`). The pre-rewrite
   Next.js site had a real questionnaire (deleted in `a994696`). Admins
   review applications with nothing in them.
3. **Gates chained behind gates, moderated in opposite directions.** To write
   a post a graduate must complete a cohort, create a profile, submit it, wait
   for an admin to publish it, and only then see Writing and Opportunities
   unlock. Profiles are pre-moderated (`IN_REVIEW` locks editing,
   `src/pages/dashboard/portfolio.astro:404-410`) while posts on the same
   profile are post-moderated ("There is no moderation queue",
   `docs/blogging.md:3-5`), and no admin page can actually take a post down.
4. **Three names for one thing.** The page called Portfolio contains a form
   called "Create Your Profile" (`portfolio.astro:197`) and publishes to
   `/talent/<handle>`; a separate page called Profile edits the account name.
   Cohorts are "Programs" in half the admin. People are builders, talent,
   students, learners, alumni. Raw enum words reach the screen (`In_review`,
   `Audit`, `Extracting audio`, `[object Object]`).
5. **Half the surfaces are half-built, and the people who bring work in have
   no front door.** Posts can be published but there is no public post page.
   Graduates cannot reach their own certificate. Contact notes promise
   delivery but only land in an inbox nobody is told about. `/hire` is linked
   from one text link on `/talent` (`src/pages/talent/index.astro:94`), and
   `/talent` from one homepage section; neither is in the nav or footer. Both
   public forms erase everything typed when the anti-spam token is stale.
6. **Scale machinery for a team of three.** Bulk atomic roster actions with a
   90-row cap and a rules paragraph, dozens of typed error codes, stale-
   selection diagnostics, a four-state profile review queue, a paused,
   preview, confirm import handshake, two parallel bearer-token systems, a
   Curricula entity with one row that blocks cohort creation, a data-migration
   console, 30 status words across 7 entities, and confirmations on the
   reversible actions but not the irreversible ones.

The fix is mostly subtraction. Ten moves, in leverage order:

| # | Move | Effect |
|---|---|---|
| 1 | State-aware dashboard: nav and home driven by the user's actual state | Removes most dead ends for every non-admin persona |
| 2 | A real application: a short questionnaire, no JSON editor | Fixes the core flow for applicants and admins |
| 3 | Finish the blog reader or hide Blog and Writing until it exists | Removes the most visible dead end for visitors and authors |
| 4 | One public profile page, self-serve publish, no review queue | Removes a four-state machine, an admin queue and an open-ended wait |
| 5 | Admin sized for three people: per-row actions, fewer entities, one credential system | Cuts the largest page and about half of the admin code |
| 6 | Public navigation and form hygiene | Makes Talent and Hire reachable; forms stop losing input |
| 7 | One vocabulary | Ends re-learning between pages |
| 8 | Statuses humans can read | Ends enum leakage and gives every state a next step |
| 9 | One feedback pattern | Replaces six success and six failure mechanisms with one |
| 10 | Right-size the limits | Relaxes the ones that hurt real users; deletes the ones that exist for concurrency nobody generates |

Section 4 details each move. Section 6 lists the concrete defects found on
the way, worth fixing regardless. Section 9 sequences the work.

## 2. Personas: what each needs versus what they get

| Persona | Needs | Gets today | Dead ends |
|---|---|---|---|
| Visitor | Understand the programme, see builders, hire one, read posts, apply | Homepage anchors, Blog placeholder, Apply behind login | Talent and Hire absent from nav and footer; Blog says "Not yet"; Apply loses its intent after login |
| Applicant | Apply with some substance, see status, know what is next | One-click apply, raw JSON editor, a "Pending" badge | No questions asked; no "what happens next"; six locked nav items |
| Enrolled learner | Sessions, Ask AI, status | Sessions and chat, plus four locked links | Pipeline states leak ("Extracting audio", "Failed"); the Portfolio lock sends them to re-apply |
| Graduate / builder | Certificate, profile, messages, opportunities, posts | Portfolio (called Profile inside), a review wait, Leads, Opportunities, Writing | No link to their certificate; no feedback channel during review; posts have no public page; opportunity outcomes never shown |
| Instructor / TA | Sessions for their cohort, the roster | Sessions and Ask AI via `programRole` (`src/lib/recordings/access.ts:14-19`); everything else locked with student copy | No staff surface at all; "Your portfolio unlocks when you complete a cohort" |
| Hiring client | Find builders, submit a project, hear back | `/hire` reachable only via `/talent`, a thank-you that hides the next steps | Never notified; a mistake in the form costs a rate-limit slot |
| Admin (1 to 3 people) | Approve applicants, run a cohort, publish profiles, approve projects, load recordings | 13-link sidebar, bulk roster machinery, review queues, two token consoles, a migration console | Three ways to change one student's status; "Application Data" is always empty |
| Automation agent | One credential with clear scope, machine-readable errors | Two credential systems with different rules | 302 to an HTML login page for a bad token; plain-text 403 pages |

### Member nav by persona

"Dead" means a lock, an empty state, or a canned answer. Verified in browser
for the new user; the rest follows from `DASHBOARD_LINKS` and each page's gate.

| Link | New sign-in | Applicant (pending, rejected, audit) | Enrolled | Graduate before publish | Graduate published |
|---|---|---|---|---|---|
| Dashboard | "Welcome back", empty card | status card | status card | status card, no certificate | same |
| Sessions | empty | empty | useful | useful | useful |
| Ask AI | example prompts, canned reply persisted | same | useful | useful | useful |
| Apply | open cohorts | other cohorts | marginal | marginal | marginal |
| Portfolio | lock, "Browse Programs" | lock | lock, sends them to re-apply | form | form and live link |
| Writing | lock, "Go to Portfolio" (another lock) | lock | lock | "isn't published yet" | posts |
| Leads | "Set up your portfolio first" (another lock) | same | same | "No leads yet", but the public page 404s | leads |
| Opportunities | "Create your profile" (another lock) | same | same | "Once your profile is published" | projects |
| Profile | name and photo | same | same | same | same |
| **Dead links** | **6 of 10** | **6 of 10** | **4 of 10** | **2 to 3 of 10** | **0** |

The ten-item nav is designed for exactly one persona, the published graduate.

## 3. What it looks like after

| Persona | Target |
|---|---|
| Visitor / hiring client | Nav: How, Why, Builders, Hire, Sign in / Apply. Blog returns when posts have a page. Forms keep input and say what happened. |
| New sign-in / applicant | Dashboard shows one next step: apply, or the application's status with one sentence per state. Nav: Dashboard, Apply, Account. |
| Enrolled learner | Nav adds Sessions and Ask AI. Nothing about profiles until they graduate. Only complete recordings, no pipeline states. |
| Graduate / builder | One "Profile" page (name, photo, bio, skills, highlights, publish toggle), publish immediately with a preview, Messages and Opportunities appear once published, certificate linked from the dashboard. |
| Instructor / TA | Sessions and the roster for their cohorts; no student copy. |
| Admin | Home is an attention list; approve and reject inline; nav grouped into six entries; one credential system. |
| Automation agent | PATs only; 401 for a bad token; HTML error pages for humans. |

## 4. The ten moves

Effort: S under a day, M one to three days, L more.

### Move 1. A state-aware dashboard (M)

**Evidence.** `DASHBOARD_LINKS` is static and the shell is a prop-less island,
so it cannot know who is signed in (`DashboardShell.tsx:21-32`). The four lock
cards for one message are four different designs
(`portfolio.astro:106-127`, `writing/index.astro:61-104`,
`opportunities.astro:128-154`, `leads.astro:102-116`). The home page is a list
of application cards under an unconditional "Welcome back"
(`dashboard/index.astro:26-28`), and a COMPLETED student is never linked to
their certificate: grep for "certificate" under `src/pages/dashboard` and the
shells returns nothing, although the route exists and the admin confirmation
promises "Completing students immediately unlocks their certificates"
(`program-application.ts:37-38`). Ask AI shows example prompts about mentor
hours to users with no cohort (`src/components/chat/Transcript.tsx:14-18`,
verified in browser), and each click persists a conversation whose only
answer is "No session recordings are available for your account yet."
(`src/pages/api/chat.ts:183-189`). The desktop sidebar never highlights the
current page because the active link is computed from `window.location`
during render (`src/components/common/Sidebar.tsx:20`); React logs a
"Prop className did not match" warning on every shell page and keeps the
server's classes. Verified in browser.

**Proposal.**

1. Pass a small state object from `DashboardLayout.astro` to the shell:
   `{ hasApplication, isEnrolled, isGraduate, hasProfile, published, isStaff,
   unreadMessages }`, plus the current path. Render only the links that apply,
   in three groups: Learn (Home, Sessions, Ask AI), Career (Profile, Messages,
   Opportunities, Writing; graduates only), Account (Account, Sign out).
   "Apply" appears only while there is an open cohort the user has not applied
   to. `ChatApp.tsx:29` derives its rail from the same list, so it follows.
2. Make the home page a status page with one next step per state: PENDING
   ("We review applications by hand; you will hear by email"), APPROVED
   (Sessions and the cohort dates), COMPLETED (certificate link, "Build your
   public profile"), staff (their cohorts' rosters and sessions).
3. Put the certificate link on the COMPLETED card and on the application page.
4. Gate Ask AI on accessible recordings: render an unlock message instead of
   `ChatApp`, stop persisting canned replies, hide the example prompts when
   there is nothing to search.
5. Keep Ask AI's full-page layout (see section 11); fix the duplicated nav by
   deriving it from the same state-aware list rather than by moving the chat
   back inside the shell.

**Delete.** The four lock cards; the duplicated nav in `ChatApp.tsx`.
**Tests.** `e2e/talent-foundation.spec.ts:100-121` pins the locked links as
always visible; `e2e/dashboard-greeting.spec.ts:36-38` pins "Welcome back";
`e2e/chat-page.spec.ts` asserts the rail's app-nav footer.

### Move 2. A real application (M)

**Evidence.** Clicking Apply posts a hidden `programId` only
(`dashboard/apply.astro:147-152`); the row is created with `application: "{}"`
(`program-application.ts:110, 334-366`). The detail page then shows a
`<textarea>` labelled "Application Data (JSON)" with "Enter your application
details as JSON." (`application/[id].astro:146-165`); invalid input is
discarded on error (`:157` re-renders the stored value) and non-pending views
print `String(value)`, so admin-enrolled alumni see
`enrollment: [object Object]` (`program-application.ts:43-48`). The admin
"Application Data" card is empty for every real applicant
(`admin/applications/[id].astro:183-197`). The deleted Next.js form
(`application.atom.ts`, removed in `a994696`) asked for name, partner school,
prerequisite checkboxes (HTML/CSS, JavaScript, Node, TypeScript, React, Git,
Next.js), previous projects, a project proposal, why you, and interests.

**Proposal.**

1. Restore a short questionnaire on `/dashboard/apply/[programId]` with a
   handful of fixed keys stored in the existing `application` JSON column.
   Decide the questions with the team; the old set is a sensible default and
   most of it can be dropped. Applying redirects to the new application's
   page, not back to the list (`apply.astro:73`).
2. Admin application detail renders those keys as labelled answers.
3. Delete the JSON textarea and its POST branch; delete the
   `getEnrollmentSource` marker once move 5 removes its only consumer.
4. One sentence per status on the applicant's page (see move 8).

**Tests.** `src/lib/admin/self-application-page.test.ts`; the cohort e2e
journeys that click the bare Apply button.

### Move 3. Finish the blog reader, or hide Blog and Writing until it exists (S to hide, M to finish)

**Evidence.** `src/pages/blog/` contains only the placeholder index ("Not
yet", `blog/index.astro:38-40`). `src/lib/blog/feed.ts:2` builds
`/blog/<handle>/<slug>`, `rss.ts:46` advertises `/blog/rss.xml`, the editor
shows authors that URL (`MetadataPanel.tsx:190`), and the Writing list prints
it as plain text (`writing/index.astro:151-154`). None of those routes exist;
`/blog/amina/shipping-my-first-api` returned 404 in the local run. Nav and a
footer group both promote Blog. The post `SUSPENDED` state and `adminNote`
column exist but no file under `src/pages/admin/` imports `blogPost`, so the
"admins take a post down after the fact" policy in `docs/blogging.md` has no
button. Cover-image columns exist with no upload. The first autosave on
`/dashboard/writing/new` obtains an id but never rewrites the URL
(`PostEditor.tsx:194-198`), so a reload orphans the draft and the next
keystroke creates a second one.

**Proposal.** Ship the listing, the post page and the RSS route (the render,
feed and sanitiser code is complete and tested), and link the live post from
the Writing list. If that is not next, remove Blog from nav and footer and
hide Writing until it ships. Either way: add a one-button "Suspend post" on
the admin profile page so post-moderation is real, or delete the state and
column; drop the cover-image columns and inputs; `history.replaceState` to
`/dashboard/writing/<id>` after the first autosave; render `state.error`
next to "Couldn't save" (`editor-state.ts:154-162`); delete
`PlainPostForm.astro`, a `<noscript>` fallback for one route in an app whose
nav button is itself disabled until hydration (`DashboardShell.tsx:63`).

### Move 4. One profile page, self-serve publish, no review queue (M)

**Evidence.** `PROFILE_TRANSITIONS` is DRAFT to IN_REVIEW to PUBLISHED, with
SUSPENDED (`src/lib/talent/transitions.ts:3-8`). The review blocks editing
for an unbounded time with "once the team responds"
(`portfolio.astro:404-410`), has no reviewer note column, no notification
path, no withdraw (the member code only does DRAFT to IN_REVIEW,
`portfolio-handlers.ts:181`), and is bypassed after the first publish ("edits
go live immediately", `portfolio.astro:159`), so it only ever reviews version
one. Admins cannot publish a draft ("Waiting on the builder",
`admin/profiles/[id].astro:288`). Highlights stay editable during review
because that island is gated on the profile row only (`portfolio.astro:422`).
The read-only rule is client-side only: `saveProfile` never checks the status,
so a crafted POST edits a profile in either state. The badge renders the enum
with CSS capitalisation, so IN_REVIEW displays as `In_review` (verified in
browser). `/talent/<handle>` is 404 until PUBLISHED
(`talent/[handle].astro:27-31`), so authors submit blind. Every input on the
form re-renders from the database, never from the submitted data
(`portfolio.astro:215-383`), so any rejection wipes the edits; skills over 30
characters and location or country overflows have no error slot and produce
a silent reload (`portfolio-handlers.ts:117-128`). Name and photo live on a
separate page (`dashboard/profile.astro`). `studentProfile.githubLogin` is
read by the public page (`talent/[handle].astro:312-322`) and the admin, but
nothing ever writes it, although `portfolio.astro:68` already fetches the
login. At phone width the draft banner squeezes its sentence into a four-line
column beside a no-wrap "Submit for Review" button (`portfolio.astro:140-172`,
verified in browser).

**Proposal.** DRAFT to PUBLISHED and back, self-serve, with a "Preview public
page" link before publishing. Admins keep Unpublish (replacing Suspend) with
an optional note the builder sees; the admin Profiles list stays as an
after-the-fact review queue. Merge name and photo into the same page. Fold the
GitHub highlights picker into the same form so there is one Save, gated the
same way, and replace its 320 px inner scroller (`RepoPicker.tsx:316`) with a
full list or a "show more". Re-render the form from the submitted values on
failure; flatten `skills.N` and the location and country errors into visible
slots; mark the handle `readonly` once published and say why in the hint
instead of rejecting on submit; persist `githubLogin`. Delete IN_REVIEW,
`sortProfilesForQueue`, the "Profiles awaiting review" card, and the
"Refresh from GitHub" button (snapshot on save instead).

**Tests.** `e2e/talent-integration.spec.ts`, `e2e/admin-review.spec.ts`,
`src/lib/talent/admin-review.test.ts`, `portfolio-handlers.test.ts`.

### Move 5. An admin console sized for three people (M to L in total)

**Evidence.** `src/pages/admin/programs/[id].astro` is 852 lines with six
POST actions, nine `?notice=` strings, an all-or-nothing bulk mutation with a
materialised CTE, `MAX_BULK_SELECTION_SIZE = 90` derived from D1's bound
parameter limit and printed to admins as "Select at most 90 applications per
action", and the paragraph "Approve accepts only PENDING or AUDIT rows.
Complete accepts only APPROVED rows. A stale or cross-cohort selection is
rejected in full without partial updates." (`:773`). The roster has no
per-row action and sits below the details form, the staff table and the
direct-enrollment form (verified in browser). Approving one application from
the list is: scan a date-sorted table for a yellow badge, View, Approve,
confirm, land on the same page with no message, Back
(`admin/applications/[id].astro:62, 229-233`). `REJECTED` and `COMPLETED`
have no exits and direct enrollment refuses when any row exists for that
user and cohort (`program-application.ts:15-24, 625-645`), so a mis-click is
permanent. Every application transition confirms, including Audit; Publish,
Suspend, project Reject and Close, Remove source, Reprocess and Revoke
confirm nothing. Success is silent on the application, profile, project and
recording detail pages and on cohort create. Curriculum is a mandatory second
entity with two fields and one row ("Create a curriculum before creating a
cohort.", `src/lib/admin/cohorts.ts:99-103`) that adds a nav item, three
pages and a one-option select on every cohort form. Client projects have a
MATCHED state that only leads to CLOSED and cannot be edited after
submission. Personal Access Tokens and Agent Access are two overlapping
bearer-token systems with different durations, validators and origin checks
(`src/lib/agent-auth.ts`, `src/lib/personal-access-tokens.ts`), and their
rules diverge: a write PAT may grant admin and run the legacy import
(`roles.ts:146-156`, `api/admin/import.ts:40` check only agent sessions) but
may not view the PAT page. Data Migration is a 467-line page plus a 773-line
library for a migration that has happened. `programPartner` has a schema and
importer but no UI; EDUCATOR is in the docs and nowhere in `src/`. The home
page is a totals board with an empty fourth slot and the pending-applications
count unlinked (`admin/index.astro:37-88`, verified in browser). Twelve
tables sit in `overflow-x-auto`; at phone width the applications table clips
its date column and scrolls sideways inside the page (verified in browser).
The roster header's screen-reader-only "Select" cell is absolutely positioned
and occupies no grid track, so every label shifts one column left and
"Learner" overlaps "Status" (`programs/[id].astro:689-696`, verified in
browser).

**Proposal.**

1. Roster: one row per learner with Approve, Reject, Complete and Reopen as
   buttons; no checkboxes, no bulk bar, no cap, no completion date unless
   completing. Keep one "Complete all approved" per cohort that also closes
   applications. Order the page by task: roster first, staff second, details
   last. Per-row Approve and Reject on the applications list too, sorted
   queue-first as profiles and projects already are
   (`src/lib/talent/admin-review.ts:7-30`).
2. On `changes === 0` show "Something changed, reload the page" and stop:
   delete the post-hoc diagnosis queries and stale-selection machinery. Keep
   the `WHERE status = ?` guard in SQL.
3. Add `REJECTED` to `PENDING` and `COMPLETED` to `APPROVED`; then confirm
   only the irreversible actions (Reject, Complete, Remove credential, Remove
   source, Revoke, Remove admin, project Close) and drop the rest.
4. Home becomes an attention list: pending applications, failed recordings,
   import sources with `lastError`, cohorts with applications open, plus the
   two existing queues.
5. Fold Curricula into Cohorts: auto-select the single row and hide the
   select, or make it a description field; drop the nav item.
6. Merge MATCHED into CLOSED with a "matched builder" note; add basic project
   editing.
7. One credential system: keep PATs, delete Agent Access and the `ttv-agent:`
   convention, express "no role changes, no legacy import" as PAT scope rules,
   return 401 (not a 302 to an HTML login page) for a rejected bearer token
   (`middleware.ts:30-34, 53-55`), and render HTML for the three plain-text
   403s. Dependency: the preview pipeline seeds a bearer session with that
   prefix (`scripts/cloudflare/agent-preview-auth.mjs:136-155`), so it moves
   to a seeded PAT in the same change.
8. Delete Data Migration (page, API route, `lib/admin/import.ts`, e2e spec);
   the CLI script remains. Delete `programPartner` or build the one select it
   needs. Delete EDUCATOR from the docs.
9. Recordings: make Drive import the primary path (the upload form pushes the
   whole video through an SSR POST with no size check and loses every field
   on error, `recordings/upload.astro:14-27, 69-87`); keep a one-time
   count-and-confirm on a folder's first scan so an old backlog is never
   transcribed by accident, then sync automatically, and persist the preview
   so a refresh does not discard it (`recordings/import.astro:83-92`). Show
   `processingError` and a Retry on the index. "Test connection" must test
   all sources, not only enabled ones, since new sources start paused
   (`settings/integrations.astro:67-71`, `recordings/import.astro:71`). Label
   the two transcript textareas (`recordings/[id].astro:131-132`).
10. Group the sidebar: Overview; Applications; Cohorts; People (Users,
    Profiles); Client projects; Recordings; Settings (Integrations, Access
    tokens). Replace index tables with the roster's responsive row pattern
    (`programs/[id].astro:689-767`) and drop every `overflow-x-auto`.
11. Users page becomes the person hub (roles, applications, profile,
    projects) and "View Profile" on an application opens it.

**Tests.** `e2e/cohort-management.spec.ts`, `e2e/import-security.spec.ts`
(deleted with the feature), `e2e/drive-import.spec.ts`,
`e2e/admin-curricula.spec.ts`, `src/lib/admin/program-application.test.ts`,
`src/lib/admin/program-detail-page.test.ts`, `AdminShell.test.tsx:46-51`.

### Move 6. Public navigation and form hygiene (S each)

**Evidence.** `NAV_LINKS` is How, Why, Cohort and Blog
(`src/layouts/PublicLayout.astro:22-27`); grep finds no `/talent` or `/hire`
link in any layout, shell or common component. The Apply pill targets
`/dashboard/apply` (`:106-111`); the middleware redirects anonymous visitors
to `/auth/login` with no return path (`src/middleware.ts:129-133`); the login
page says "Welcome back", "Pick up where you left off" and "mentor notes are
all waiting" (`src/pages/auth/login.astro:36-52`, verified in browser;
"mentor notes" exists nowhere else) and cites terms of service that have no
page (`:57`); the GitHub button always lands on `/dashboard`
(`GitHubSignInButton.tsx:20`). On `/hire` the spam guard runs before
validation and records a submission on every pass
(`hire/index.astro:25-31`, `src/lib/spam/protection.ts:101-104`); the form
has `novalidate` (`:243`), so each missing field burns one of five hourly
slots; on a token failure `prev` is never filled (`:19, 52-61`) and all eight
fields render empty with "Something went wrong"; a submit within three
seconds of load, routine with autofill, trips `MIN_FILL_SECONDS`
(`protection.ts:9`). Success re-renders in place (`:87`) so refresh re-posts,
and the "What happens next" steps disappear exactly then (`:493`). Budget is
required (`validation.ts:38-40`) although "Prefer not to say" is a choice;
skills are silently cut to 12 tags of 30 characters (`validation.ts:50-57`).
The contact form on `/talent/[handle]` validates first (right order) but
blanks `formValues` in the guard-fail branch (`:82-87`), has no
post-redirect-get, and promises delivery ("on its way to Amina",
`:364-367`) when no email is sent: the row waits in `/dashboard/leads`. Its
rate-limit copy blames demand ("Lots of interest right now", `:373`) for a
per-IP limit whose scope is site-wide (`:77`). Logout is a GET with side
effects (`logout.astro:9-13`). The directory offers four filter selects, a
Filter button and a daily reshuffle (`directory-helpers.ts:15-26`) for a
directory the hero sizes at "~25 students" (verified in browser with two
cards). The mobile menu never closes on same-page anchor taps
(`PublicLayout.astro:155-159`). Dashed "Profile coming" cards are labelled
"Cohort 04 · Kenya" and "Cohort 03 · Nigeria"
(`HumansSection.astro:13-18`) beside real people, and render a dangling
"Cohort 04 · " when a country is missing. No public page passes a
description, so every share preview is generic; there is no
`src/pages/404.astro`, so mistyped URLs lose the nav.

**Proposal.**

1. Nav: How, Why, Builders, Hire, Blog when it exists, Sign in, Apply. Footer
   mirrors it; add Terms and Privacy pages or drop the sentence. Add a
   `404.astro` on the public layout.
2. Preserve intent: `/auth/login?next=<path>` for same-origin paths, passed
   as `callbackURL`. Neutral login copy that states a GitHub account is
   required.
3. Both public forms: validate before the spam guard, populate previous
   values on every failure path, keep the form visible with values on rate
   limit, redirect on success and keep "What happens next" visible. Replace
   "Something went wrong" with "This page was open a while. Your details are
   still here, press Send again." Email the builder on a new contact note or
   change the promise. Make budget optional; show the skills cap. Extract one
   shared form and honeypot partial.
4. Directory: Skill and Availability only, auto-submit on change, order by
   `publishedAt`; delete the rotation hash.
5. Logout as a POST button in both shells; close the mobile menu on tap.
6. Homepage: delete the fabricated placeholder cards, fix the dangling
   separator, pull the dated literals ("~25 students", "Cohort 04") into one
   constant, pass a description per page.

### Move 7. One vocabulary (S)

| Concept | Names in use today | Use |
|---|---|---|
| A training run | Cohort (admin nav, dashboard), Program (URL, admin home, recordings, error copy), curriculum title on cards | **Cohort** |
| The public talent record | Portfolio (nav), Profile (heading, admin), builder profile (copy), `/talent` (URL) | **Profile** |
| Account settings | Profile (nav) | **Account** |
| Inbound contact notes | Leads (nav), note, message | **Messages** |
| Recorded classes | Sessions (dashboard), Recordings (admin) | **Sessions** (recordings only in the pipeline) |
| The blog | Blog (nav), Field notes (title), Notes from the cohort (heading), Writing (dashboard) | **Blog** and **Posts** |
| The person | student, learner, builder, talent, user, applicant, alumni | **Applicant** until approved, **learner** while enrolled, **builder** once graduated |
| Chat threads | New chat, New discussion, Earlier discussion, Conversations | **Chats** |
| A hidden form action | `action`, `_action`, `status` | `action` |

Also: the Cohorts column "Applications" shows Open/Closed; "Admin → Settings
→ Integrations" names a level that does not exist; the home title
"Dashboard" versus nav "Admin Home"; nav order How, Why, Cohort versus page
order Why, What we do, Values, Cohort.

### Move 8. Statuses humans can read (S)

- **Badge.** Give `Badge.astro` a label map (`:44-51`): PENDING and AUDIT
  read "Under review", APPROVED "Accepted", REJECTED "Not accepted",
  IN_REVIEW "In review", PUBLISHED "Live". Use it from the editor's status
  pill and the admin filter pills.
- **Applications.** AUDIT has no meaning in the UI, no path to COMPLETED
  (`program-application.ts:15-24`), and AUDIT learners cannot watch sessions
  (`access.ts` requires APPROVED or COMPLETED). Delete it, keep the enum
  value for stored rows. One sentence per status for the applicant.
- **Recordings.** Students see eight pipeline states, including "Failed"
  (`ProcessingStatus.astro`, `sessions/index.astro:48`). Show complete
  recordings only, or one neutral "Processing" chip.
- **Opportunities.** Remove the "Approved" badge on every card
  (`opportunities.astro:205`, verified in browser); add a "Your interests"
  section with outcomes, since MATCHED and CLOSED projects simply vanish.
- **Admin.** Name change-status buttons with verbs (Approve, Reject,
  Complete, Reopen), not adjectives.
- **Timestamps.** `formatDuration` treats zero as missing
  (`src/lib/recordings/time-utils.ts:8`), so the first transcript segment and
  any citation at the start read "--" (verified in browser). Pipeline
  timeouts surface as raw milliseconds (`pipeline.ts:195`).

### Move 9. One feedback pattern (M)

Success is shown five ways (query-string code, URL-encoded sentence,
same-page re-render, silent redirect, JS status card) and failure six.
Across the 50 forms, 13 redirect after success, 22 re-render in place so a
refresh re-submits (creating a token this way mints a second one,
`admin/personal-access-tokens.astro:29-51`), 12 lose the user's input on
error, and no Astro form disables its submit button in flight, including the
multi-minute video upload. The banner markup is pasted into at least six
dashboard pages and six admin spellings; only some set a `role`.
Confirmations come in three mechanisms. `dashboard/apply.astro:73` and the
curricula pages already do it right.

**Proposal.** One `Flash` partial rendered by every layout from a one-shot
cookie set before redirect; one `Notice` component with `status` and `alert`
roles for in-place validation errors; every mutation ends in a redirect. This
removes the eight `?notice=` code maps and the URL-encoded messages on the
import page.

### Move 10. Right-size the limits

The instinct that some limits are excessively broad is right, but the broad
ones are gates and safety machinery rather than field lengths. The ones that
hurt real users are, if anything, too narrow. Verdicts: Keep, Narrow, Fix,
Remove.

| Limit or gate | Value | Where | What the person sees | Verdict |
|---|---|---|---|---|
| Nav visibility | everyone sees everything | both shells | six dead links | Narrow: gate by state (move 1) |
| Login required for `/dashboard/*` including the Apply CTA | all | `middleware.ts:129-133` | "Welcome back" login, then dashboard home | Fix: carry `next` |
| Profile page requires cohort COMPLETED | whole page | `portfolio.astro:23, 27` | lock with "Browse Programs" | Narrow: gate publication, not creation; let learners draft during the cohort |
| Profile edits locked while IN_REVIEW | whole form | `portfolio.astro:404-410` | "once the team responds" | Remove the state |
| Writing and Opportunities require PUBLISHED | page | `writing/index.astro:19`, `validation.ts:80` | lock chain | Narrow: follows from move 4; hide links until reachable |
| Leads requires any profile row | page | `leads.astro:22` | "Set up your portfolio first" | Fix the CTA for ineligible users |
| Sessions and Ask AI require APPROVED or COMPLETED, or a staff role | list, API | `recordings/access.ts:5-57` | empty list; canned chat reply saved | Keep the rule; gate the chat page; stop persisting canned replies |
| Anti-spam token age | 3 s to 2 h | `spam/protection.ts:9-10, 70` | "Something went wrong", form emptied | Fix: keep input, say what happened; use 1 s and 24 h (autofill trips 3 s; a 4,000-character message can take over 2 h) |
| Public form rate limit | 5 per hour per IP per scope | `protection.ts:11, 88-99` | hire: "Too many submissions"; contact: "Lots of interest right now"; form removed | Narrow: hire counts failed validations; contact scope is site-wide so a recruiter is blocked on the sixth builder; both hide a 60-minute window. Scope contact per profile |
| Hire budget | required enum with a "Prefer not to say" option | `validation.ts:38-40` | "Please select a budget range." | Remove the requirement (the column already defaults to UNDISCLOSED) |
| Hire skills | 12 tags x 30 chars, silent | `validation.ts:50-57` | nothing | Fix: say it |
| Contact fields | name 120, email 254, org 120, message 4,000 | `contact-helpers.ts:3-22` | inline errors | Keep |
| Handle | 3 to 39, lowercase, reserved words, locked after publish | `handles.ts:46-69`, `portfolio-handlers.ts:86-105` | lock discovered on submit | Keep; make the input `readonly` |
| Headline, bio, location, country | 120 / 4,000 / 120 / 56 | `profile.ts:14-17` | two of four errors never rendered | Keep; fix error slots |
| Skills on profile | 12 x 30 | `profile.ts:11, 18` | raw zod text or silence | Fix messages |
| Profile URLs | 300 chars, https only | `profile.ts:3-9` | "URL must use HTTPS", then the form wipes | Narrow: accept http or upgrade it |
| Highlights | 6, blurb 500, repo list capped at the 100 most recently pushed | `RepoPicker.tsx:32-33`, `github.ts:72-76` | counter; older repos silently absent | Keep; mention the 100 |
| Account name | required, no maximum | `dashboard/profile.astro:44-56` | none | Fix: add a cap, it is printed on certificates |
| Avatar | 5 MB, image types minus SVG, resized to 1024 | `avatar.ts:3-27` | clear messages | Keep; drop the resize sentence from the UI |
| Post | title 200, body 40,000, excerpt 300, slug 80 | `post.ts:3-7`, `slug.ts:4-12` | rich mode has no body cap, so "Couldn't save" with no reason; a manual excerpt is clipped to 160 in the meta description (`seo.ts:14`) | Fix: surface the error; one excerpt length |
| Chat message | 2,000 chars, server only | `api/chat.ts:172-174` | "message is too long" after the composer cleared | Fix: enforce in the composer with a counter |
| Chat history | 8 turns client-side; server accepts an unbounded array | `ChatApp.tsx:32`, `api/chat.ts:265` | invisible | Fix: enforce on the server |
| Chat lists | 30 sessions; oldest 100 messages | `chat/sessions.ts:120, 190-194` | newest messages dropped after 100 | Fix: load newest; page or state the caps |
| Chat rate limit | none; each call is an embedding, a vector query and an LLM call | `api/chat.ts` | none | Add a per-user limit |
| Hidden list caps | tokens 50, audit rows 10, admin tables unbounded | `personal-access-tokens.ts`, `credentials/store.ts` | unhinted | Fix: one rule, paginate above N (not re-verified) |
| Bulk selection | 90 rows, all-or-nothing | `program-application.ts:40-41, 590-614` | "Select at most 90", batch voided by one wrong tick | Remove with bulk |
| Application transitions | REJECTED and COMPLETED terminal; no withdraw | `program-application.ts:15-24` | no undo | Fix: add Reopen; consider withdraw |
| Cohort requires curriculum | hard FK | `cohorts.ts:99-110` | "Create a curriculum before creating a cohort." | Remove with the entity |
| Cohort description | required, never shown to learners | `cohorts.ts`, `program-management.ts` | forced typing | Narrow: optional |
| PAT count, label, lifetime, scope | 10 active, 50 chars, 8 h to 30 d, read or write | `personal-access-tokens.ts:4, 9, 74-99` | clear | Keep; single system, two durations |
| Delegated credentials on the PAT page | blocked even for GET | `middleware.ts:75-89` | plain-text 403 | Keep the rule; render a page |
| Expired or invalid PAT | no cookie fallback | `middleware.ts:30-34` | 302 to an HTML login page | Fix: 401 |
| Admin mutation origin | all unsafe methods | `mutation-security.ts:57-73` | plain-text 403 | Keep; render a page; delete the unreachable per-page duplicates |
| Completion date | not after server-UTC today | `program-application.ts:140-181` | "cannot be in the future" | Keep |
| "Test connection" | enabled sources only | `integrations.astro:67-71` | passes while the new, paused source is untested | Fix: test all |
| Recording upload size | none in code | `upload.astro:14, 27` | Workers body-limit failure | Remove the path or add a limit and a message |
| Recordings pipeline | 3 retries, concurrency 1, FFmpeg 25 min, transcription 12 min, cron every 15 min | `wrangler.jsonc`, `pipeline.ts` | timeouts in raw milliseconds | Keep; surface failures in the UI |
| Directory filters | Skill, Country, Availability, Cohort plus a Filter button | `talent/index.astro:102-191` | six controls before the first card on a phone | Narrow: two filters, auto-submit |
| Sidebar link count | 10 member, up to 13 admin | both shells | flat lists | Narrow: 5 to 7 per persona |
| Cookie cache | 5 min | `auth.ts:39-42` | up to 5 min stale role after a change | Keep |

## 5. Findings by persona

The moves cover most of what was found. These are the remaining items worth
doing when a page is touched.

**Visitor.** Hero CTA "Explore Programs" scrolls to a section headed "A
community, not a course." Sign-in appears twice above the fold. Section
numbers (§ 00 to 03) disagree with nav order. Four React islands exist only
to run entrance animations on static copy and none honours
`prefers-reduced-motion` although `ValuesSection.tsx:12-13` says they do,
while an unused CSS `.reveal` utility that does honour it sits in
`global.css:99-118`; they can be `.astro`. The sign-in button is a hydrated
island whose only job is one redirect. Etymology appears three times before
the value proposition. Blog has three names. Five hard-coded "Cohort 04" and
"~25 students" literals will age separately.

**Certificate.** `SignatureMark.astro` documents itself as a stand-in drawn
for layout prototypes (`:5-8`), and `CertificateCard.astro:48` renders it
under the real instructor's name on the live, printable credential;
`docs/certificate-print.md:85` records the missing asset. Get a real
signature asset or remove the mark. Type is sized in `cqw` with no floor
(`CertificateCard.astro:98-114, 140-141, 275-277`); at 390 px the metadata
labels compute to roughly 4 px (not verified in browser). "Copy link"
silently does nothing when the clipboard is denied
(`CertificateActions.astro:35-40`). Delete the unused dark variant and the
three dev prototypes now the decision has shipped.

**Applicant and learner.** Apply success strands the user on the same list
with the cohort removed (`apply.astro:73, 102-104`). The Portfolio lock's
"Browse Programs" sends an enrolled learner to re-apply. Sessions: ISO dates
here, "Mar 4, 2026" elsewhere; the detail page hides `recording.description`;
`<track kind="captions">` has no `src` although the VTT is stored
(`SessionViewer.tsx:53`), so native captions are empty; the transcript panel
is its own scroller inside the page scroll (`TranscriptPanel.tsx:70`,
`SessionViewer.tsx:42-64`, verified in browser on desktop; on phones the aside
has no max height, so a long transcript should push the video away while
playing, not verified). Admins can stream a video whose page redirects them
(`api/recordings/[id]/video.ts:53` allows `isAdmin`, `sessions/[id].astro:29-30`
does not). Ask AI: a message over 2,000 characters is rejected after the
composer has cleared (`api/chat.ts:172-174`, `Composer.tsx:52`) and stays
stranded with no retry; the composer has a hydration mismatch on
`enterKeyHint`; the legacy `sessionId IS NULL` pseudo-session needs a one-off
migration; mock mode and mock transcripts ship inside the production
component; the hand-rolled markdown renderer duplicates the blog's pipeline.

**Graduate / builder.** Leads has a manual "Mark Read" and a permanent
Archive (`leads.astro:168-191`); auto-read on open, undo on archive, unread
count in the nav, and an email on arrival. The Opportunities page uses its own
container and `<h1>` inside the shell (`opportunities.astro:125-126`), so it
sits in a narrower column than every other page and the document has two h1s
(verified in browser). Six places say "reach out to the team" with no link
(`portfolio.astro:163, 417`, `hire/validation.ts:87`,
`PlainPostForm.astro:162`, both rate-limit messages).

**Instructor / TA.** No staff surface: sessions work through `programRole`,
everything else shows student copy. Move 1 adds their cohorts' rosters and
sessions to the status page and hides the career links.

**Admin.** Internal IDs and rule text in copy ("Application <cuid> no longer
exists", "does not grant admin:write"). Direct enrollment requires a
completion date even for APPROVED ("Used only for COMPLETED.",
`programs/[id].astro:656-670`). Recording upload drops every field and the
file on its one error. The Drive "Historical import review" card exists only
on the POST response. The recording edit form accepts an empty title
server-side (`recordings/[id].astro:24`) and passes an unvalidated date to
`new Date` (not re-verified). Integrations: four button styles in one row,
two disclosures that edit the same impersonated user
(`integrations.astro:304-346`), and an audit table whose Action column shows
raw tokens (`set`, `update-config`); one form with Save, Test and Remove and a
"Last updated by, last test" line would do. Transcript edits update the text
columns only, so search results diverge from the edited transcript (not
re-verified). The users page shows applications but not staff roles or the
talent profile.

## 6. Bugs found on the way

Defects, not preferences; worth fixing whether or not the moves are adopted.

1. A failed Google Drive connection test is assigned to the success variable
   and renders in the green banner (`settings/integrations.astro:83-86`).
2. `Badge.astro` renders the raw enum with CSS capitalisation: `In_review`
   on the profile banner and the admin profiles list. Verified in browser.
3. The desktop sidebar never shows the current page; React logs a className
   hydration mismatch on every shell page (`Sidebar.tsx:20`). Verified.
4. The cohort roster header shifts one column left because the sr-only
   "Select" cell occupies no grid track; "Learner" overlaps "Status"
   (`programs/[id].astro:689-696`). Verified.
5. Hire and contact forms blank all fields on a token failure; the hire form
   records a rate-limit hit before validating (`hire/index.astro:25-61`,
   `talent/[handle].astro:82-87`).
6. Upload form drops every field on validation error
   (`recordings/upload.astro:69-87`).
7. AUDIT applications can never complete and cannot access recordings.
8. Chat history loads the oldest 100 messages, so after 50 exchanges the
   newest are the ones dropped (`chat/sessions.ts:190-194`).
9. No rate limit on `POST /api/chat`; the server accepts an unbounded
   history array.
10. The chat composer clears before the server answers; a "message is too
    long" rejection discards the text.
11. Logout is a GET; link prefetchers can sign users out
    (`auth/logout.astro:9-13`).
12. A reload at `/dashboard/writing/new` after the first autosave orphans
    the draft (`PostEditor.tsx:194-198`).
13. Published posts have no public page; `feed.ts:2` builds URLs that 404.
    Verified.
14. No admin page can suspend a post, so `SUSPENDED` and `adminNote` are
    unreachable.
15. The contact form success copy promises direct delivery; no email is sent.
16. The login page cites terms of service that do not exist and promises
    "mentor notes" that exist nowhere.
17. The live certificate renders a documented stand-in signature under the
    instructor's name (`CertificateCard.astro:48`, `SignatureMark.astro:5-8`).
18. Homepage renders fabricated "Profile coming" cards labelled with cohorts
    and countries, and a dangling "Cohort 04 · " when a country is missing
    (`HumansSection.astro:13-18, 49-51`).
19. `studentProfile.githubLogin` is read by the public page but never
    written.
20. The profile read-only rule for IN_REVIEW and SUSPENDED is client-side
    only; `saveProfile` accepts a POST in either state.
21. Creating a personal access token or agent session re-renders without a
    redirect, so a refresh mints a second credential.
22. Direct video upload has no size or type check on the server; the
    recording edit form accepts an empty title.
23. "Test connection" only checks folders of enabled sources, so it reports
    "passed" while a freshly added, paused source is unreadable.
24. Graduates have no path to their certificate from the dashboard.
25. `formatDuration` shows "--" for 0:00 (`time-utils.ts:8`). Verified.
26. Every opportunity card carries a meaningless "Approved" badge and
    MATCHED or CLOSED projects vanish without telling the builder the
    outcome.
27. Admins can stream a video whose page redirects them (`video.ts:53`
    versus `sessions/[id].astro:29-30`).
28. `<track kind="captions">` has no `src` (`SessionViewer.tsx:53`).
29. The Portfolio validation path silently reloads for skills over 30
    characters and location or country overflows (no error slot).
30. Pipeline timeouts surface as raw milliseconds ("timed out after
    1500000ms", `pipeline.ts:195`).
31. GitHub 403 responses (rate limiting) are reported as "Sign out and back
    in to reconnect GitHub" (not re-verified).
32. Admin-only API routes answer 401 rather than 403 to a signed-in
    non-admin (not re-verified).
33. The hire success state hides the "What happens next" steps exactly when
    they matter (`hire/index.astro:493`).
34. The mobile marketing menu stays open after tapping a same-page anchor
    (`PublicLayout.astro:155-159`).

## 7. Consistency inventory

Counts from grep on `main`.

| Pattern | Count |
|---|---|
| Raw `<button>` vs `<Button>` component | 57 vs 52; about 40 distinct spellings; `Button.astro` cannot be used from React, so 17 React components hand-roll their own |
| Inputs on `.form-control` vs inline class strings vs bespoke public forms | 50 vs 6 vs 2 forms |
| Status words across entities | 30 (applications 5, profiles 4, posts 3, projects 5, interest 2, leads 3, recordings 8) |
| Badge variants / badge implementations | 16 / 6, with different hues for the same meaning |
| Success and error banner spellings | 6 in the admin, 6 in the member area, 13 overall; no toast component |
| Forms: redirect after success / re-render in place / lose input on error / disable submit in flight | 13 / 22 / 12 / 0 of 50 |
| Date formats | 4 member, 4 admin |
| Names for the person | builder, talent, student, learner, alumni, applicant |
| Names for the cohort | cohort, program, curriculum title |
| Names for the public page | portfolio, profile, portfolio profile, builder profile, `/talent` |
| Member nav items | 10, none gated |
| Admin nav items | 11 to 13, flat |
| Desktop sidebar active state | none on any page (mobile drawer only) |
| Duplicated definitions | application statuses in six places with three status-to-badge maps; budget bands in four; the post schema twice; three date parsers; the token label rule twice; the same-origin check in three places; eligibility checked four times |
| Empty states | missing on the users table, the "Application Data" card, the integrations audit section |
| Loading states | only inside React islands; no Astro form shows progress |
| Nested scroll regions | by design: chat transcript, editor canvas. Worth removing: editor settings panel over the canvas, the repo picker's 320 px list, the transcript panel, twelve horizontally scrolling admin tables |

`ARCHITECTURE.md` says `Button` was deleted; it exists and is the most-used
primitive.

## 8. Keep as is

- The immersive layout for Ask AI and the editor: one scroll region, composer
  pinned, keyboard handled. Reuse it, do not redesign it.
- The publish-carries-the-draft form in the editor, and Markdown as the
  source of truth.
- The atomic SQL in `program-application.ts` and the `WHERE status = ?`
  guards. Keep the mechanism, cut the copy it emits.
- The handle lock after publication; the 39-character handle; the avatar
  pipeline; the certificate route and its screen-first design.
- Curricula's form pattern (values preserved, field errors, PRG with
  `?notice=`) is the model for every other admin form.
- The cohort roster's responsive row layout is the model for every table.
- The spam guard mechanism (honeypot, signed token, per-IP count). Only its
  ordering, scope, windows and messages need work.

## 9. Sequencing

Each phase leaves the app shippable.

**Phase 1, quick and low-risk (copy, nav, small code paths; one to two
weeks of S items).** Fix the bugs in section 6; Builders and Hire in nav and
footer; return-to after login and neutral login copy; PRG and value
preservation on the two public forms; relax the spam windows and scope the
contact limit; certificate link on the dashboard; hide Blog and Writing until
the reader ships, or ship the two pages; the vocabulary table; verbs on status
buttons; the badge label map; delete AUDIT; add Reopen; right-size
confirmations; attention-list home; delete Data Migration and the Agent
Access page (the preview pipeline moves to a seeded PAT in phase 2); the
sidebar active state; the "--" timestamp.

**Phase 2, structural (changes flows; needs test rewrites).** State-aware
dashboard nav and home page; the application questionnaire; one profile page
with self-serve publish and highlights folded in; roster with per-row actions
and no bulk machinery; curriculum folded; one credential system; recordings
as one folder per cohort with a first-scan confirm; one Flash and Notice
feedback mechanism.

**Phase 3, consolidation (no behaviour change).** One Button usable from
both Astro and React, one Notice, one form-field partial, one date helper;
grouped admin nav; responsive rows instead of tables; de-React the homepage
and login; move mocks out of production components; drop dead columns
(`adminNote`, cover image fields, `programPartner`) with migrations; merge
the duplicate validators and date parsers; retire the legacy chat shim;
`<h2>` page titles everywhere; fix `ARCHITECTURE.md`.

Phase 1 alone removes most of what a first-time applicant and a hiring client
would call clunky.

## 10. Decisions needed from the owner

1. Application: restore a short questionnaire (recommended; which questions?)
   or keep one-click apply and decide out of band?
2. Blog: finish the public post page, or hide Writing until it exists?
3. Post takedown: add the one "Suspend post" button so post-moderation is
   real (recommended), or delete the state?
4. Profile review: drop pre-moderation and publish on the member's action
   (recommended), or keep it and add withdraw plus an ETA?
5. AUDIT status: still used? If not, retire it.
6. Curricula: fold into cohorts (recommended) or keep as an entity?
7. Agent Access: retire in favour of PATs (recommended; the preview pipeline
   moves with it)?
8. Data Migration: has the legacy import happened? If so, delete.
9. Recording upload: keep alongside Drive import, or remove?
10. Drive import: keep a one-time count-and-confirm on a folder's first scan
    (recommended, it protects the transcription budget) or sync always?
11. Contact relay: send the email, or change the promise?
12. Hire form: is budget genuinely required?
13. Leads: keep the manual "Mark Read", or auto-mark on view?
14. Certificate signature: obtain a real asset, or remove the mark until then?

## 11. Where the two reviews disagreed

1. **Application fields.** One review said "do not add fields"; the other
   said restore the questionnaire the old site had. Merged position: a
   one-click apply gives admins nothing to decide on, so restore a short form
   with the old questions as the default set, and let the owner cut it down.
2. **Ask AI layout.** One review proposed rendering the chat inside the
   dashboard shell on desktop. The owner asked on 2026-08-29 for a full-page
   chat that drops the normal nav, and PR #109 shipped it. Merged position:
   keep the immersive layout; fix the duplicated nav by deriving it from the
   state-aware link list.
3. **Post `SUSPENDED` state.** One review proposed deleting it; the other
   assumed it worked. It is unreachable today. Merged position: ship the
   one-button takedown, because post-moderation is the policy being extended
   to profiles; delete the state only if the owner prefers no takedown.
4. **Spam windows.** One review said 2 h is fine once input survives; the
   other proposed 1 s and 24 h. Merged position: do both, since input
   preservation is what matters and the wider window costs nothing.
5. **Drive import handshake.** One review proposed always-on sync with a
   "Scan now"; the other proposed persisting the current preview. Merged
   position: keep a single count-and-confirm on a folder's first scan to
   protect the transcription budget, then sync automatically.

## Appendix A. Method and evidence

- Two independent full-read reviews, each with three or four parallel audits
  (public, member, admin, cross-cutting limits and consistency), each claim
  re-checked against the source before inclusion here.
- Two local runs: migrations applied to a fresh D1, one seeded with the
  preview-environment fixtures and one with a hand-written seed of one
  account per persona (new sign-in, pending applicant, enrolled learner,
  graduate without a profile, graduate in review, published builder,
  rejected applicant, admin) plus cohorts, recordings, messages, posts and
  client projects; bearer-token sessions so Playwright could render every
  route as each persona at 1280 px and on a Pixel 7 profile, about 150
  screenshots in the second run. Requires the two temporary `wrangler.jsonc`
  edits (remove the AI and Vectorize bindings, disable containers) and
  `AGENT_AUTH_ENABLED=true` in `.dev.vars`; none of that is committed.
- Screenshots are in the SAM library under `/ux-review-2026-09/` (eight,
  persona seed) and `/design/ux-review-2026-09/` (25, preview fixtures).
- Not confirmed visually: certificate type size on phones, the transcript
  panel with a long transcript on phones, and the recording upload size
  failure on Cloudflare. Items marked "not re-verified" were reported by one
  review and not independently checked by the other.
