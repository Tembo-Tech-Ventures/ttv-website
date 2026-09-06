# UX simplification review

*September 2026. Read-only review of every route, for every persona, plus a
drive of the real app on a seeded local database at desktop (1280px) and
Pixel 7 sizes. Paths below are relative to `web/`.*

## 1. Summary

The site is no longer one product. It is seven, stapled together: a marketing
site, an applications workflow, session recordings with AI chat, a talent
directory with a hiring funnel, a blog, an admin console, and an automation
access layer. Each arrived as one large batch (talent platform in PRs #63–68 on
one day, admin platform in #73 the next day, recordings and credentials in
#75/#76, tokens in #83, chat in #102/#109, blog in #117) and each batch brought
its own navigation entries, status vocabulary, form pattern, safety machinery
and copy. Nothing was ever consolidated across batches, and everything was sized
for a scale TTV does not have: about a dozen users, two cohorts, one to three
admins.

That is where the "overly complicated" feeling comes from. The individual pages
are mostly fine. The problems are structural:

- **Every user sees every feature.** The dashboard shows the same ten links to a
  brand-new applicant, an enrolled learner, a graduate, and an instructor, and
  six of those links are locked or empty for most of them. The admin sidebar
  is a flat list of up to thirteen.
- **The most important flow is the thinnest.** "Apply" is a single button that
  stores `{}`; the applicant is then invited to edit their application as raw
  JSON. The old Next.js site had a real questionnaire. Admins therefore review
  applications with no information in them.
- **Half the surfaces are half-built.** Authors can publish blog posts, but there
  is no public page that renders one. Graduates cannot reach their own
  certificate. Contact notes promise delivery but only land in an inbox nobody
  is told about. Partners, the EDUCATOR role, post suspension, cover images and
  the "audit" application status exist in the schema or UI with no counterpart.
- **Scale machinery for a team of three.** Bulk atomic roster actions with a
  90-row cap, 46 typed error codes, stale-selection diagnostics, a four-state
  profile review queue, a paused/preview/confirm import handshake, two parallel
  bearer-token systems, and a 1,300-line legacy data-migration console.
- **Five vocabularies, six feedback patterns, about forty button spellings.**
  Cohort/program, profile/portfolio/account, leads/notes/messages,
  sessions/recordings, blog/field notes; success shown by query-string codes,
  URL-encoded sentences, same-page re-render, silent redirect, or a JS status
  card.

The ten moves below fix this in leverage order. The first four change what
users experience most; the rest remove weight. Section 6 lists the concrete
bugs found on the way, which are worth fixing regardless.

| # | Move | Effect |
|---|------|--------|
| 1 | State-aware dashboard: nav and home page driven by the user's actual state | Removes most dead ends for every non-admin persona |
| 2 | A real application form (restore the questionnaire; delete the JSON editor) | Fixes the core flow for applicants and admins |
| 3 | Finish the blog reader or hide Blog until it exists | Removes the most visible dead end for visitors and authors |
| 4 | Talent profile: publish/unpublish instead of a review queue | Removes a four-state machine, an admin queue and a blocking wait |
| 5 | Admin: per-row actions, no bulk, no scale diagnostics, fewer entities | Cuts the largest page and about half of the admin code |
| 6 | Public navigation and form hygiene | Makes Talent and Hire reachable; stops forms losing input |
| 7 | One vocabulary | Removes constant re-learning between pages |
| 8 | Statuses humans can read | Ends enum leakage ("In_review", "audit", "Extracting audio") |
| 9 | One feedback pattern | Replaces six success and six failure mechanisms with one |
| 10 | Right-size the limits | Relaxes the ones that hurt real users; deletes the ones that exist only for concurrency nobody generates |

## 2. How this was reviewed

- Read every page, layout, shell, component and library module under `src/`
  (44 page routes, 8 dev-only routes, 14 API routes, about 27,600 lines of
  application code and 13,300 lines of tests), plus the e2e suite to learn
  which behaviours are currently treated as critical.
- Four parallel audits (public visitor, dashboard personas, admin, cross-cutting
  limits and consistency); the last one inventoried 123 limits and gates, all
  50 forms, every button spelling, every feedback surface, every confirmation
  and every nested scroll region. Every claim used below was re-verified against
  the code before inclusion.
- Drove the real app locally: applied migrations to a fresh D1, seeded the same
  fixtures the preview environments use, enabled bearer auth, and captured every
  route as an anonymous visitor and as the seeded admin at 1280px and Pixel 7,
  plus scripted journeys (one-click apply, the JSON editor, empty hire submit,
  mobile drawers, profile creation). Per-page metrics: no horizontal overflow
  on any route at either size, and no unintended nested scroll region on the
  captured pages. The nested scrollers listed in Appendix A come from reading
  the components, since the fixtures do not exercise all of them.
- Checked git history for what the pre-rewrite application form asked, so the
  recommendation in move 2 is a restoration, not an invention.

Screenshots are in the SAM library under `/design/ux-review-2026-09/`.

## 3. Personas: what each needs versus what they get

| Persona | Needs | Gets today | Dead ends |
|---|---|---|---|
| Visitor | Understand the programme, see builders, hire one, read posts, apply | Homepage anchors, Blog placeholder, Apply (auth-walled) | Talent and Hire absent from nav/footer; Blog says "Not yet"; Apply loses intent after login |
| Applicant | Apply with some substance, see status, know what's next | One-click apply, raw-JSON editor, status badge "pending" | No questions asked; no "what happens next"; six locked nav items |
| Enrolled learner | Sessions, Ask AI, status | Sessions + chat, plus Apply/Portfolio/Writing/Leads/Opportunities locked | Pipeline states leak ("Extracting audio"); chat persists dead answers for users without recordings |
| Graduate / builder | Certificate, profile, leads, opportunities, posts | Portfolio (called "Profile" inside), review wait, Leads, Opportunities, Writing | No link to own certificate; review has no feedback channel; posts have no public page |
| Instructor / TA | Sessions for their cohort, roster | Sessions, Ask AI; everything else locked with student copy | No staff surface at all; "Your portfolio unlocks when you complete a cohort" |
| Hiring client | Find builders, submit a project, hear back | `/hire` form (reachable only via `/talent`), thank-you page | Never notified; skills "matching" claim is display-only |
| Admin (1–3 people) | Approve applicants, run a cohort, publish profiles, approve projects, load recordings | 13-link sidebar, bulk roster machinery, review queues, token consoles, migration console | Three ways to change one student's status; "Application Data" is always empty |

## 4. The ten moves in detail

### Move 1: a state-aware dashboard

**Evidence.** `DASHBOARD_LINKS` in `src/components/shells/DashboardShell.tsx`
is a static list of ten links and the shell is a prop-less island, so it cannot
know who is signed in. An applicant with a PENDING application sees Sessions,
Ask AI, Portfolio, Writing, Leads and Opportunities, all of which render a lock
card or an empty state (`src/pages/dashboard/portfolio.astro:107-127`,
`writing/index.astro:61-104`, `opportunities.astro:128-154`,
`leads.astro:102-116`, four different lock designs for one message). The home
page (`src/pages/dashboard/index.astro`) is only a list of application cards;
a COMPLETED student is never linked to their certificate from anywhere in the
dashboard. Instructors and TAs, who have recording access via `programRole`
(`src/lib/recordings/access.ts`), get student copy everywhere else. Ask AI
rebuilds the whole nav as a text list at the bottom of its rail because it
leaves the shell (`src/components/chat/ChatApp.tsx:383-393`).

**Proposal.**

1. Pass a small `userState` object from `DashboardLayout.astro` to the shell:
   `{ hasApplication, isEnrolled, isGraduate, hasProfile, profileStatus,
   isStaff, unreadLeads }`. Render only the links that apply, in three groups:
   *Learn* (Home, Sessions, Ask AI), *Career* (Profile, Messages,
   Opportunities, Writing — graduates only), *Account* (Account, Sign out).
   "Apply" appears only while there is an open cohort the user has not applied
   to.
2. Make the home page a status page with one next step per state: PENDING
   ("We review applications by hand; you will hear from us by email"),
   APPROVED (link to Sessions and the cohort dates), COMPLETED (certificate
   link, "Build your public profile"), staff (their cohorts' rosters and
   sessions).
3. Put the certificate link on the COMPLETED application card and on the
   status page.
4. Render Ask AI inside the shell on desktop; keep the full-viewport layout for
   the transcript and composer (the `h-dvh` fix is a CSS concern that can live
   inside the shell's main area). On mobile keep the current header/sheet.

**Delete.** The four lock cards (replace with one `ProfileGate` partial or,
better, with not showing the link), the duplicated nav in `ChatApp.tsx`.

**Tests to update.** `e2e/talent-foundation.spec.ts:100-121` pins
Portfolio/Leads/Opportunities as always visible; `e2e/chat-page.spec.ts`
asserts the rail's "Back to dashboard" and app-nav footer.

### Move 2: a real application

**Evidence.** Clicking Apply posts a form whose only field is a hidden
`programId` (`src/pages/dashboard/apply.astro:147-152`); the row is created with
`application: "{}"` (`src/lib/admin/program-application.ts:360-361`). The
detail page then shows a textarea labelled "Application Data (JSON)" with the
help text "Enter your application details as JSON."
(`src/pages/dashboard/application/[id].astro:149-160`); any parseable JSON is
accepted and stored verbatim, nested values render as "[object Object]". On the
admin side the "Application Data" card is an empty heading for every real
applicant, and shows the internal marker `{"source":"ADMIN","schemaVersion":1}`
for admin-enrolled rows (`src/pages/admin/applications/[id].astro:183-197`).
The deleted Next.js form (`application-form.tsx`, `application.atom.ts` in git
history) asked for: partner school, seven prerequisite checkboxes (HTML/CSS,
JavaScript, Node, TypeScript, React, Git, Next.js), previous projects, a project
proposal, "why should we choose you", and interests.

**Proposal.**

1. Restore a questionnaire on `/dashboard/apply/[programId]`: a handful of
   fields with fixed keys stored in the existing `application` column (which
   already holds JSON). Decide the questions with the team; the old set is a
   sensible default. Applying should redirect to the new application's page,
   not back to the list.
2. Admin application detail renders those keys as labelled answers. Nothing
   else changes in the schema.
3. Delete the JSON textarea and the "Save Application" path; delete the
   `getEnrollmentSource` marker (move 5 removes its only consumer).
4. Explain each status to the applicant on the application page in one line.

**Tests to update.** `src/lib/admin/self-application-page.test.ts` and the
cohort e2e journeys that click the bare Apply button.

### Move 3: finish the blog reader, or hide Blog until it exists

**Evidence.** `src/pages/blog/` contains only the placeholder `index.astro`
("No posts up yet. Check back when Cohort 04 starts shipping"). There is no
`/blog/[handle]/[slug]` page and no RSS route, while `src/lib/blog/feed.ts`,
`render.ts`, `rss.ts`, the API, and the 10,000-line editor from PR #117 are
complete and tested. The dashboard "Writing" list prints the public path as
plain text, not a link (`src/pages/dashboard/writing/index.astro:151-153`), and
the editor's settings panel shows a URL that 404s. Nav and footer both promote
Blog. The gate to write is three steps deep (complete a cohort, publish a
profile, then write) and the reward is a page that does not exist.

**Proposal.** Ship the two public pages (`/blog` listing from `toFeedItem`, the
post page from `renderPostHtml`, plus `/blog/rss.xml`), and link the live post
from the Writing list. If that is not next on the roadmap, remove Blog from nav
and footer and hide Writing from the dashboard until it is. Either way delete
the post `SUSPENDED` state and `adminNote` (no admin page writes them: no file
under `src/pages/admin/` imports `blogPost`) and the cover-image columns and
inputs (no upload exists), and rewrite the URL after the first autosave so a
reload at `/dashboard/writing/new` does not orphan the draft
(`src/components/blog/editor/PostEditor.tsx:190-200` records the id in state
only).

### Move 4: talent profile as publish/unpublish

**Evidence.** `PROFILE_TRANSITIONS` in `src/lib/talent/transitions.ts` is
DRAFT → IN_REVIEW → PUBLISHED/DRAFT, PUBLISHED → SUSPENDED → PUBLISHED. The
review blocks editing for an unbounded time, has no reviewer note column
(`studentProfile` in `src/lib/db/schema.ts`), sends no notification, and is
bypassed after the first publish ("edits go live immediately",
`portfolio.astro:150-160`), so it only ever reviews version one. Admins cannot
publish a DRAFT directly ("Waiting on the builder",
`src/pages/admin/profiles/[id].astro:288`). The badge renders the enum with CSS
capitalisation, so IN_REVIEW displays as "In_review". Two near-identical
"paused" messages appear on one screen for SUSPENDED
(`portfolio.astro:163,416`). The "not editable while under review or
suspended" rule is enforced only by hiding the form: `saveProfile` in
`src/components/portfolio/portfolio-handlers.ts` never checks the status, so
a crafted POST edits a profile in either state. The same form re-renders every
field from the database on a validation error, so typed changes vanish.

**Proposal.** DRAFT ↔ PUBLISHED, self-serve, with a "Preview public page"
link before publishing; admins keep Unpublish (replacing Suspend) with an
optional note the builder sees. Fold the GitHub highlights picker into the
same form so there is one Save (today a profile save discards unsaved highlight
selections because the picker is a separate fetch-based island). Disable the
handle input once published and say why in the hint instead of rejecting on
submit. Delete IN_REVIEW, the admin review queue, `sortProfilesForQueue`, the
"Profiles awaiting review" card, and the "Refresh from GitHub" button (refresh
snapshots on save instead).

**Tests to update.** `e2e/talent-integration.spec.ts` (create → submit → admin
publish), `e2e/admin-review.spec.ts`, `src/lib/talent/admin-review.test.ts`.

### Move 5: an admin console sized for three people

**Evidence.** `src/pages/admin/programs/[id].astro` is 852 lines with five POST
forms, eight `?notice=` codes and an all-or-nothing bulk mutation with a
materialised CTE, a `MAX_BULK_SELECTION_SIZE = 90` derived from D1's bound
parameter limit and printed to admins as "Select at most 90 applications per
action", and copy such as "A stale or cross-cohort selection is rejected in full
without partial updates." There is no per-row action on the roster: approving
one learner means tick a box, click "Approve selected", confirm. The same
status can also be changed on the application page and by "Direct enrollment",
which requires a completion date even for APPROVED ("Used only for
COMPLETED."). `program-application.ts` defines 22 error codes,
`program-management.ts` 15, `roles.ts` 5, `import.ts` 4; create and update of a
cohort use two separate validation stacks with three hand-rolled date parsers.
Curriculum is a mandatory second entity before the first cohort can exist
("Create a curriculum before creating a cohort."), and nothing consumes it
except a select and a column. Client projects have a MATCHED state that only
leads to CLOSED. Personal Access Tokens and Agent Access are two overlapping
bearer-token systems with different durations, validators and origin checks;
Data Migration is a 1,300-line console for a migration that has already
happened; `programPartner` has a schema and importer but no UI; EDUCATOR is in
the docs and nowhere in `src/`.

**Proposal.**

1. Roster: one row per learner with Approve / Reject / Complete (and
   Reopen/Undo, see move 8) as buttons; no checkboxes, no bulk bar, no
   selection cap, no completion date unless completing. Order the page by task:
   roster first, staff second, cohort details last (or on a separate Edit
   page).
2. On `changes === 0` show "Something changed, reload the page" and stop:
   delete the post-hoc diagnosis queries and the stale-selection machinery.
   Keep the `WHERE status = ?` guard in SQL; it costs nothing.
3. One validation module per entity with one date parser.
4. Make curriculum optional or fold its two fields into the cohort form; if it
   stays, drop the store abstraction and the "Curricula before Cohorts" sidebar
   ordering rule.
5. Merge MATCHED into CLOSED with a "matched builder" note; add basic project
   editing (client typos are currently permanent) and confirmations on the
   irreversible actions (Reject, Close, Suspend, Remove source, Revoke).
6. Keep Personal Access Tokens as the single token mechanism; delete Agent
   Access and the `ttv-agent:` prefix convention, pointing e2e at a PAT and
   expressing "no role changes, no legacy import" as PAT scope rules. Note the
   dependency: the preview deploy pipeline (`scripts/cloudflare/agent-preview-auth.mjs`)
   seeds a bearer session with that prefix, so the pipeline moves to a seeded
   PAT in the same change. Move tokens under a "Developer" heading rather than
   between Integrations and Logout.
7. Delete the Data Migration page, API route and `lib/admin/import.ts`; the
   CLI script remains for any re-run. Delete `programPartner` or build the one
   select it needs. Delete EDUCATOR from the docs.
8. Recordings: one folder per cohort, always synced, with a "Scan now" that
   queues new files and reports counts. Drop the paused/preview/confirm
   handshake and the `expectedImportable` check (a new recording landing
   between review and confirm should not send the admin back a step). Show
   `processingError` and a Retry on the index. Merge the Integrations
   credential card onto the recordings page where the admin actually gets
   stuck. Drop the VTT textarea; make transcript edits either re-index or be
   read-only.
9. Group the sidebar: People (Users), Training (Cohorts, Applications,
   Recordings), Talent (Profiles, Client Projects), Setup (Integrations,
   Developer). Rename the `/admin/programs` URL or at least stop calling the
   entity "Program" in copy.

**Tests to update.** `e2e/cohort-management.spec.ts`, `e2e/import-security.spec.ts`
(deleted with the feature), `e2e/drive-import.spec.ts`, `e2e/admin-curricula.spec.ts`,
`src/lib/admin/program-application.test.ts` (large), `AdminShell.test.tsx:46-51`.

### Move 6: public navigation and form hygiene

**Evidence.** `NAV_LINKS` in `src/layouts/PublicLayout.astro` is How, Why,
Cohort (three homepage anchors) and Blog; the footer adds Apply and Sign in.
`/talent` is reachable only through a homepage link that renders when at least
one profile is published, and `/hire` only through a link on `/talent`. The
Apply pill sends visitors to `/dashboard/apply`, the middleware redirects to
`/auth/login` with no return-to, and the GitHub button hard-codes
`callbackURL: "/dashboard"`, so the intent is lost. The login page greets
first-time applicants with "Welcome back / Pick up where you left off" and
promises "mentor notes", which do not exist, and cites terms of service that
have no page. On `/hire` the spam guard runs before validation and records a
submission on every pass (`src/pages/hire/index.astro:25-63`,
`src/lib/spam/protection.ts:101-104`), so with `novalidate` each missing
required field burns one of five hourly slots; on a token failure `prev` is
never populated so all eight fields blank. This is easy to trigger: submitting
within three seconds of page load, which browser autofill makes routine, hits
`MIN_FILL_SECONDS`, and the page comes back with "Something went wrong. Please
try again." above an empty form (captured in the screenshot set). The contact form on
`/talent/[handle]` has the same blanking on guard failure, no
post-redirect-get (refresh re-posts), and a success message ("Your note is on
its way to Amina", "delivered to them directly") when nothing is sent: the row
lands in `/dashboard/leads` and nobody is notified. Logout is a GET
(`src/pages/auth/logout.astro`). The directory offers four filter selects plus
a Filter button and a daily reshuffle (`fairSort`, `rotationHash`) for a
directory the hero itself sizes at "~25 students"; on a phone the filters fill
the first screen before any builder appears.

**Proposal.**

1. Nav: Talent, Hire, Blog (when it exists), About (one anchor), Sign in,
   Apply. Footer mirrors it and adds Terms/Privacy pages or drops the sentence.
2. Preserve intent: middleware redirects to `/auth/login?next=<path>` for
   same-origin paths; the button passes `next` as `callbackURL`. Neutral login
   copy.
3. Both public forms: validate before the spam guard, populate previous values
   on every failure path, keep the form visible with values on rate limit,
   redirect on success (`?sent=1#contact`). Extract one shared form + honeypot
   partial. Email the builder on a new contact note (both addresses are known)
   before promising delivery, or change the copy.
4. Directory: Skill and Availability filters only, auto-submit on change,
   order by `publishedAt`; delete the rotation hash.
5. Logout as a POST button in both shells.
6. Homepage: delete the fabricated "Profile coming · Cohort 03 · Nigeria"
   placeholder cards, fix the dangling "Cohort 04 · " label, make the marquee
   words match the five stated values, and pull the six dated facts
   ("~25 students", "Cohort 04", "Two students in fintech internships")
   into one place that is easy to update.

### Move 7: one vocabulary

| Concept | Names in use today | Use |
|---|---|---|
| A training run | Cohort (admin nav, dashboard), Program (URL, admin home "Total Programs", recordings, error copy "Return to Programs") | **Cohort** |
| The public talent record | Portfolio (nav), Profile (page heading, admin), builder profile (copy) | **Profile** |
| Account settings | Profile (nav) | **Account** |
| Inbound contact notes | Leads (nav), note, message | **Messages** |
| Recorded classes | Sessions (dashboard), Recordings (admin) | **Sessions** (recordings only in the pipeline) |
| The blog | Blog (nav), Field notes (title), Notes from the cohort (h1), Writing (dashboard) | **Blog** / **Posts** |
| The learner | student, learner, builder, user, applicant, signed-in user, historical alumni | **Applicant** until approved, **learner** while enrolled, **builder** once graduated |
| Chat threads | New chat, New discussion, Earlier discussion, Conversations | **Chats** |
| A hidden form action | `action`, `_action`, `status` | `action` |

### Move 8: statuses humans can read

- **Applications.** `AUDIT` has no meaning in the UI, no path to COMPLETED
  (`PROGRAM_APPLICATION_TRANSITIONS` in `program-application.ts:15-24`), and
  AUDIT learners cannot watch sessions (`access.ts` requires APPROVED or
  COMPLETED). Delete it. Add reversible transitions (REJECTED → PENDING,
  COMPLETED → APPROVED) so a mis-click is recoverable; then the confirm dialogs
  on every transition can go. Show applicants one sentence per status.
- **Profiles and posts.** Fix the badge to render a label, not the enum
  (`In_review`), and remove the "approved" badge that sits on every
  opportunity card.
- **Recordings.** Students see eight pipeline states ("Extracting audio",
  "Indexing", "Failed"). Show complete recordings only, or one neutral
  "Processing" chip; never "Failed" to a student. Drop the "Complete" chip on
  ready cards.
- **Admin.** Change-status buttons are named after adjectives ("Approved",
  "Rejected", "Audit"). Use verbs: Approve, Reject, Complete, Reopen.

### Move 9: one feedback pattern

Today success is shown five ways (query-string code → text, URL-encoded
sentence, same-page re-render after POST so refresh re-submits, silent
redirect, JS status card) and failure six ways (inline alert + 400, `?error=`,
same-page string with 200, bare red paragraph without a role, plain-text 403
response, JSON rendered by page script). Across the 50 forms, 13 redirect after
success, 22 re-render in place (so a refresh re-submits; creating a token this
way mints a second one), 12 lose the user's input on error, and none of the
Astro forms disables its submit button while the request is in flight. The
same banner markup is pasted into at least six dashboard pages and only two
set `role`. Confirmations come in three mechanisms (native `confirm()`, a
two-click disclosure, one custom inline dialog) and ten irreversible actions
have none.

**Proposal.** One `Flash` partial rendered by every layout from a one-shot
cookie, set by a helper before redirect; one `Notice` component with `status`
and `alert` roles for in-place validation errors. Every mutation ends in a
redirect. This also removes the eight `?notice=` code maps and the URL-encoded
messages on the import page.

### Move 10: right-size the limits

The user's instinct that "some limits are excessively broad" is right, but the
broad ones are mostly gates and safety machinery rather than field lengths.
The ones that actually hurt real users are, if anything, too narrow.

| Limit | Where | Today | Verdict |
|---|---|---|---|
| Nav visibility | `DashboardShell.tsx`, `AdminShell.tsx` | Everyone sees everything | Too broad: gate by state (move 1) |
| Route guards | `src/middleware.ts` | `/dashboard/*` needs a session, `/admin/*` needs ADMIN | Fine |
| Public form spam guard | `src/lib/spam/protection.ts` | Honeypot; token age 3 s–2 h; 5 submissions/hour/IP/scope | Too narrow: 3 s trips autofill, 2 h is short for a 4,000-char message, and "contact" is one bucket across all profiles so a recruiter is blocked on the sixth builder. Use 1 s, 24 h, and scope contact per profile |
| Hire fields | `src/components/hire/validation.ts` | org/name 120, email 254, title 160, description 4,000, skills 1,000 raw then silently cut to 12×30, budget required | Fine except: budget should be optional (the DB already defaults to UNDISCLOSED and the select offers "Prefer not to say"); show the skills cap instead of truncating silently |
| Contact fields | `src/components/talent/contact-helpers.ts` | name 120, email 254, org 120, message 4,000 | Fine |
| Profile fields | `src/lib/talent/profile.ts`, `handles.ts` | handle 3–39 with 43 reserved words, headline 120, bio 4,000, 12 skills × 30, URLs 300 HTTPS-only | Fine; HTTPS-only will reject some legitimate personal sites |
| Highlights | `RepoPicker.tsx`, `api/portfolio/highlights.ts` | 6 repos, blurb 500, first 100 repos by push date | Fine |
| Avatar | `src/lib/avatar.ts` | 5 MB, image/* minus SVG, resized to 1024 | Fine; drop the resize sentence from the UI |
| Application | `program-application.ts` | one per user per cohort; five statuses; no undo; no withdraw; JSON payload unbounded | Undo and withdraw missing (move 8); AUDIT unnecessary; the payload cap comes free with a real form |
| Account name | `src/pages/dashboard/profile.astro` | required, no maximum | Add a cap; it is printed on certificates and cards |
| Bulk roster | `program-application.ts:40-41` | 90 rows per action, all-or-nothing | Delete (move 5) |
| Curriculum required | `src/lib/admin/curricula.ts:100-103` | Cohort cannot exist without one | Too broad: make optional |
| Cohort description required | `cohorts.ts`, `program-management.ts` | Mandatory, never displayed to learners | Too broad: optional |
| Blog | `src/lib/blog/post.ts`, `slug.ts`, `api.ts` | title 200, body 40,000, excerpt 300, slug 80; schema declared twice | Fine as numbers; the rich-text editor has no length guard so an over-long post only ever sees "Validation failed"; a manual 300-char excerpt is clipped to 160 in the meta description; a published slug stays editable while a published handle is locked for the same reason |
| Chat history | `ChatApp.tsx:32`, `api/chat.ts` | last 8 messages, client-side only | Server accepts an unbounded history array; enforce there |
| Hidden list caps | `personal-access-tokens.ts`, `credentials/store.ts`, admin index pages | tokens 50, audit rows 10, chats 30, messages 100, admin tables unbounded | Inconsistent and unhinted; pick one rule (paginate above N) |
| Chat | `src/pages/api/chat.ts`, `src/lib/chat/sessions.ts`, `ChatApp.tsx` | message 2,000 (server only, no counter), 8 history turns, topK 50, 8 sources, 30 sessions listed, 100 messages loaded oldest-first, no rate limit | Add `maxLength` and a counter; load newest messages; raise or paginate the 30-session list; add a per-user rate limit (each call is an embedding, a vector query and an LLM call) |
| Tokens | `src/lib/personal-access-tokens.ts`, `agent-auth.ts` | 10 active PATs, durations 8h/1d/7d/30d; agent sessions 1h/8h/24h/7d | Two systems: keep one, two durations |
| Recordings pipeline | `wrangler.jsonc`, `pipeline.ts` | 3 retries, concurrency 1, FFmpeg 25 min, transcription 12 min, cron every 15 min | Fine; surface failures in the UI |
| Upload | `src/pages/admin/recordings/upload.astro` | `accept="video/*"`, no size check, no progress | The limit exists (Workers body size) but is hidden; add a size warning or drop direct upload in favour of Drive |
| Directory filters | `src/pages/talent/index.astro` | Skill, Country, Availability, Cohort + Filter button | Too broad for ~25 profiles: two filters, auto-submit |
| Sidebar link count | shells | 10 dashboard, up to 13 admin | Too many: 5–7 per persona |

## 5. Flow-by-flow notes

The moves above cover most of what was found. These are the remaining
per-flow items worth doing when a page is touched.

**Visitor.** "Explore Programs" scrolls to a section headed "A community, not
a course"; rename it to what it does. Three of four nav links are anchors on
`/`, the mobile menu stays open after tapping one, and the section numbers
(§ 00–03) disagree with nav order. Four React islands exist only to run entrance
animations on static copy; they can be `.astro` with a CSS reveal. The sign-in
button is a hydrated island whose only job is one redirect. Every public page
shares the same meta description because no page passes SEO props; profile
pages should set the headline and avatar.

**Certificate.** `SignatureMark.astro` is documented as a stand-in drawn for
layout prototypes, yet `CertificateCard.astro:48` renders it under the real
instructor's name on the live, printable, verifiable credential. Remove it
until real signature assets exist. Add the owner path from the dashboard.
Delete the unused `tone="dark"` variant, `issueDateISO`/`issueYear`, the
`director` mark and the three dev prototypes now the decision has shipped.

**Sessions.** The date format is ISO here and "Mar 4, 2026" elsewhere. The
detail page hides `recording.description` and shows the title below the video.
`<track kind="captions">` has no `src` although the VTT is stored, so native
captions are empty; serving it lets the transcript panel collapse on mobile.
Admins can stream a video whose page redirects them (`video.ts` checks
`isAdmin`, `sessions/[id].astro` does not).

**Ask AI.** Users with no accessible recordings get a canned answer that is
persisted as a conversation; show a static empty state instead and do not
create a session. Retire the legacy `sessionId IS NULL` pseudo-session shim
with a one-off migration. Move mock mode, mock transcripts and the fake answer
out of the production component into the dev page. The hand-rolled markdown
renderer duplicates the blog's remark/rehype pipeline.

**Profile (account).** Two forms, two buttons, no "remove photo". One form,
one Save, renamed Account.

**Leads / Messages.** A three-state inbox (new/read/archived) with a manual
"Mark Read" and a permanent Archive. Two states, auto-read on open, undo on
archive, unread count in the nav, and an email on arrival.

**Opportunities.** Uses its own container, `h1`, and public-site pill buttons
inside the dashboard. Builders who raised a hand never learn the outcome
because MATCHED/CLOSED projects vanish from the list; add a "Your interests"
section with outcomes.

**Admin users.** The user page shows applications but not staff roles or the
talent profile; make it the person hub and link cohorts from application and
recording pages. "View Profile" on the application page goes to the user, not
the talent profile.

**Admin integrations.** Four visual button styles in one row, three separate
forms that edit "Impersonated user", and an audit table whose Action column
shows raw tokens (`set`, `update-config`). One form with Save, Test and
Remove, plus "Last updated by X on Y · Last test passed/failed on Z".

## 6. Bugs found on the way

These are defects, not preferences; they are worth fixing whether or not the
moves above are adopted.

1. A failed Google Drive connection test is assigned to the success variable
   and renders in the green banner (`src/pages/admin/settings/integrations.astro:83-86`).
2. `Badge.astro` renders the raw variant with CSS capitalisation, so IN_REVIEW
   shows as "In_review" on the admin profiles list and header.
3. The cohort roster header on desktop puts a screen-reader-only "Select" cell
   inside a five-column grid; because it is absolutely positioned it occupies
   no track, every header label shifts one column left and "Learner" overlaps
   "Status" (`src/pages/admin/programs/[id].astro:689-696`).
4. Upload form drops every field on validation error (no `value=` on any input,
   `src/pages/admin/recordings/upload.astro:64-93`).
5. Hire and contact forms blank all fields on a token failure, and the hire
   form records a rate-limit hit before validating.
6. AUDIT applications can never complete and cannot access recordings.
7. Chat history loads the oldest 100 messages, so after 50 exchanges the newest
   are the ones dropped (`src/lib/chat/sessions.ts:190-194`).
8. No rate limit on `POST /api/chat`.
9. Logout is a GET; link prefetchers can sign users out.
10. A reload at `/dashboard/writing/new` after the first autosave orphans the
    draft and the next keystroke creates a second one.
11. Transcript edits on the admin recording page update the text columns only,
    so search results diverge from the edited transcript; Reprocess upserts
    vectors by chunk index and never removes stale ones from a previously
    longer run.
12. The contact form success copy promises direct delivery; no email is sent.
13. The login page cites terms of service that do not exist.
14. The certificate carries a prototype signature drawn as a stand-in.
15. Homepage cohort section renders fabricated "Profile coming" cards labelled
    "Cohort 04 · Kenya" and "Cohort 03 · Nigeria", and a dangling "Cohort 04 · "
    when a country is missing.
16. `studentProfile.githubLogin` is read by the public page but never written
    by the editor.
17. The profile editor's read-only rule for IN_REVIEW and SUSPENDED is
    client-side only; `saveProfile` accepts a POST in either state.
18. Creating a personal access token or agent session re-renders the page
    without a redirect, so a browser refresh mints a second credential.
19. The chat composer clears before the server answers; a "message is too
    long" rejection discards the text (the only place the 2,000-char limit
    is enforced).
20. Direct video upload has no size or type check on the server; an oversize
    file ends in a bare platform 413. The recording edit form accepts an
    empty title and passes an unvalidated date to `new Date`, so a bad date is
    a 500.
21. GitHub 403 responses (rate limiting) are reported as "Sign out and back in
    to reconnect GitHub."
22. Pipeline timeouts surface as raw milliseconds ("Transcription timed out
    after 720000ms").
23. "Test connection" only checks folders of enabled sources, so it reports
    "passed" while a freshly added, paused source is unreadable.
24. Admin-only API routes answer 401 rather than 403 to a signed-in
    non-admin.

## 7. Suggested sequencing

**Phase 1 — quick, low-risk (touches copy, nav and small code paths).**
Fix the bugs above; Talent/Hire in nav and footer; return-to after login; PRG
and value preservation on the two public forms; relax the spam windows and
scope the contact limit; certificate link on the dashboard; hide Blog and
Writing until the reader ships (or ship the two pages); vocabulary table;
verbs on status buttons; delete AUDIT; add Reopen/Undo transitions; delete
Data Migration and the Agent Access page (the seeded preview session it shares
a mechanism with moves to a PAT in phase 2).

**Phase 2 — structural (changes flows; needs test rewrites).**
State-aware dashboard nav and home page; the application questionnaire;
profile publish/unpublish with highlights folded in; roster with per-row
actions and no bulk machinery; curriculum optional; recordings as one folder
per cohort with Scan now; one Flash/Notice feedback mechanism.

**Phase 3 — consolidation (no behaviour change).**
One Button, one Notice, one form-field partial; de-React the homepage and
login; move mocks out of production components; drop dead columns
(`adminNote`, cover image fields, `githubLogin` or populate it,
`programPartner`) with migrations; merge the duplicate validators and date
parsers; retire the legacy chat shim.

Each phase leaves the app shippable. Phase 1 alone removes most of what a
first-time applicant and a hiring client would call clunky.

## Appendix A: consistency inventory (from the cross-cutting audit)

**Buttons.** `Button.astro` (3 variants × 2 sizes) is used 52 times across 21
pages and cannot be used from React, so 17 React components hand-roll their
own. About 40 distinct spellings exist. Three admin detail pages each
re-implement the same status-coloured button row; three admin index pages each
copy the same filter chip; the marketing pill exists in five paddings; the
GitHub sign-in, data-migration and certificate buttons are one-offs.
`CLAUDE.md` says `Button.astro` was deleted; it exists and is the most-used
primitive, so the doc needs updating either way.

**Status pills.** `Badge.astro` has 16 variants and renders the raw enum;
`ProcessingStatus.astro`, the editor's `STATUS_PILL`, the cohort "Open/Closed"
pill, the import "Automatic/Paused" pill, the token "Active/Expired/Revoked"
text and the talent "Open to freelance/roles" chips are all separate
implementations with different hues for the same meaning (draft is gray in
one, teal in another; the Portfolio status banner uses a third palette next to
the badge on the same line).

**Feedback surfaces.** Thirteen banner spellings (dashboard green/red box,
admin emerald/red, cohort-page green-200 variant, borderless recordings
banner, amber environment notice, public result boxes, hire section swap,
RepoPicker boxes, chat bare paragraph, editor strip, editor save indicator,
data-migration JS card, five field-error spellings). No toast component; the
only transient feedback is the certificate "Link copied" label.

**Empty states.** Most list pages have one. Exceptions: the users table renders
an empty body, the application "Application Data" card renders an empty
definition list for every self-application, and the integrations audit
section hides rather than saying "no activity".

**Loading states.** Only inside React islands (chat, repo picker, editor,
GitHub button, migration). No Astro form disables its button or shows
progress, including the multi-minute video upload.

**Nested scroll regions.** By design: the chat transcript and desktop rail,
the editor canvas. Worth removing: the editor settings panel scrolls over the
canvas (two vertical scrollers at once, on phones too), the repo picker's
320px list inside the Portfolio page, and the transcript panel inside the
session page. Twelve admin tables scroll horizontally on narrow screens.

**Duplicated definitions.** Application statuses in six places with three
status-to-badge maps; budget bands in four; the post schema twice; contact and
hire schemas with different copy ("or less" vs "or fewer"); three date
parsers; the token label rule twice; highlights limits in the API and the
island; the same-origin check in three places; the admin gate in middleware
and again in the layout and two API routes; eligibility checked four times.

## Appendix B: evidence

Screenshots (25) are in the SAM library under `/design/ux-review-2026-09/`,
numbered in the order the flows are discussed: public site (01–07), student
dashboard and application (08–13), talent and writing (14–15, 25), Ask AI
(16–17), admin (18–23), certificate (24). Each file's description states what
it shows. They were captured from a local dev server seeded with the
preview-environment fixtures, so names and cohorts are fixture data.
