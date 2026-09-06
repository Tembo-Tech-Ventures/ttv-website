# UX simplification review

Reviewed 2026-09-06 against `main` at `048bd95`. Every finding cites a file and
line. Paths are relative to `web/` unless they start with `docs/`.
"Verified in browser" means the screen was rendered in a local run seeded with
one account per persona and screenshotted at desktop and phone widths
(Appendix A). Everything else is from reading the code.

Scope: all 66 routes (23 admin pages, 13 member pages, 8 public pages, 14 API
routes, 8 dev-only pages), all 27 tables, both shells, the middleware, and the
e2e journeys that document intent.

## 1. The short version

Nothing here is complicated on its own. The complexity comes from six
decisions that each made sense locally and compound badly:

1. **One navigation for every state.** The member shell shows the same ten
   links to everyone (`src/components/shells/DashboardShell.tsx:21-32`). For a
   person who just signed in, six of the ten lead to a lock, an empty state,
   or a canned answer. Verified in browser.
2. **Gates chained behind gates, moderated in opposite directions.** To write a
   blog post a graduate must: complete a cohort, create a profile, submit it,
   wait for an admin to publish it, and only then see Writing and
   Opportunities unlock. Profiles are pre-moderated (`IN_REVIEW` locks
   editing, `src/pages/dashboard/portfolio.astro:404-410`) while posts on the
   same profile are post-moderated ("There is no moderation queue",
   `docs/blogging.md:3-5`).
3. **Three names for one thing.** The page called Portfolio contains a form
   called "Create Your Profile" (`portfolio.astro:197`) and publishes to
   `/talent/<handle>`; a separate page called Profile edits the account name
   and photo. Cohorts are "Programs" in half the admin. People are builders,
   talent, students, learners, alumni. Raw status words leak to the screen
   (`In_review`, `Audit`, `[object Object]`).
4. **The people who bring work in have no front door, and the forms they meet
   punish them.** `/hire` is linked from exactly one place, a text link on
   `/talent` (`src/pages/talent/index.astro:94`), and `/talent` is linked from
   one homepage section. Neither is in the nav or footer. Both public forms
   erase everything typed when the anti-spam token is stale, and the hire form
   spends a rate-limit slot before it validates.
5. **Finished features that no one can reach.** Posts can be published but
   there is no public post page (`src/pages/blog/` contains only the
   placeholder index; `src/lib/blog/feed.ts:2` builds URLs that 404, verified
   in browser). Certificates exist but nothing in the dashboard links to them.
   The public profile reads a GitHub field that nothing ever writes.
6. **An admin built for a scale it does not have.** For roughly 11 people and
   2 cohorts: a Curricula entity with one row that blocks cohort creation,
   bulk selection with a 90-row cap and a rules paragraph, two credential
   systems, a data-migration page, 13 nav items, 30 status words across 7
   entities, and confirmations on the reversible actions but not the
   irreversible ones.

The fix is mostly subtraction. Section 3 is the plan; sections 4 to 8 are the
evidence.

## 2. What it looks like after

Per persona, the target experience this review is aiming at:

| Persona | Today | Target |
|---|---|---|
| Visitor / hiring client | Talent and Hire unreachable from nav; Blog in nav is a placeholder | Nav: How, Why, Builders, Hire, Sign in / Apply. Blog returns when posts have a page. |
| New sign-in / applicant | "Welcome back", 10 links, 6 dead | Dashboard shows one next step (apply, or your application's status). Nav: Dashboard, Apply, Account. |
| Enrolled student | Same 10 links, 4 dead, "Browse Programs" CTA sends them to re-apply | Nav adds Sessions and Ask AI. Nothing about profiles until they graduate. |
| Graduate / builder | Profile, Portfolio, Writing, Leads, Opportunities as five pages; review wait | One "Public profile" page (name, photo, bio, skills, highlights, publish toggle), publish immediately, Writing and Opportunities appear once published, certificate linked from the dashboard. |
| Admin | Totals board, 5-step approve, 13 links | Home is an attention list; approve/reject inline; nav grouped into 6 entries. |
| Automation agent | Two credential systems with different rules | One (PATs), 401 instead of a login page for a bad token. |

## 3. The plan

Effort: S = under a day, M = one to three days, L = more. Each item names the
files it touches. Items inside a phase are independent of each other.

### Phase 0. Quick wins (all S)

1. **Put Builders and Hire in the public nav, take Blog out until it has
   posts.** `src/layouts/PublicLayout.astro:22-59`. Add a `src/pages/404.astro`
   on the public layout so mistyped URLs keep the nav.
2. **Carry the destination through login.** Middleware redirects to
   `/auth/login?next=<path>` (`src/middleware.ts:129-133`); the login page
   passes an allow-listed same-origin `next` to the GitHub button's
   `callbackURL` (`src/components/auth/GitHubSignInButton.tsx:20`). Today
   "Apply" ends on the dashboard home.
3. **Rewrite the login copy for the person it receives.** "Welcome back / Pick
   up where you left off / mentor notes are all waiting" greets first-time
   applicants (`src/pages/auth/login.astro:36-52`). "Mentor notes" exists
   nowhere else. "By signing in, you agree to our terms of service" links
   nothing (`:57`).
4. **Never discard form input on the anti-spam guard.** Hire: build `prev`
   before the guard and validate before recording a rate-limit slot
   (`src/pages/hire/index.astro:25-61`). Contact: restore `formValues` in the
   guard-fail branch (`src/pages/talent/[handle].astro:82-87`). Replace
   "Something went wrong" with "This page was open a while. Your details are
   still here, press Send again."
5. **Post-redirect-get on every form that writes.** Hire, contact, profile,
   portfolio, leads, opportunities, application detail, integrations, PATs,
   recording upload and detail all re-render on POST, so a refresh re-submits.
   `src/pages/dashboard/apply.astro:73` already does it right.
6. **Link the certificate from the dashboard.** COMPLETED card on
   `src/pages/dashboard/index.astro:39-64` and the application detail page.
   The route exists; nothing member-facing links to it.
7. **Delete the JSON application editor.** Applicants are shown "Application
   Data (JSON)" with "Enter your application details as JSON."
   (`src/pages/dashboard/application/[id].astro:146-165`). Applications carry
   no fields (`src/lib/admin/program-application.ts:110`), so render a plain
   summary and drop the POST branch.
8. **Fix the status label layer.** Give `Badge.astro` a label map so
   `in_review` renders "In review" not "In_review", `PENDING`/`AUDIT` read
   "Under review", `APPROVED` reads "Accepted", `PUBLISHED` reads "Live".
   `src/components/common/Badge.astro:44-51`. Verified in browser: the
   review banner shows `In_review`.
9. **Every "contact the team" dead end gets a mailto.** Six places say "reach
   out to the team" with no link (`portfolio.astro:163,417`,
   `src/components/hire/validation.ts:87`,
   `src/components/blog/editor/PlainPostForm.astro:162`, hire and contact
   rate-limit copy).
10. **Admin home becomes an attention list.** Pending applications is a number
    with no link while the two rarest queues get "View queue"
    (`src/pages/admin/index.astro:52-88`). Link it, and add failed recordings,
    import sources with `lastError`, and cohorts with applications open.
11. **Right-size confirmations.** Confirm Reject, Complete, Remove credential,
    Remove source, Revoke, Remove admin. Stop confirming Approve and Audit
    (`src/pages/admin/applications/[id].astro:229-233`); start confirming
    project Reject and Close, which are terminal
    (`src/pages/admin/projects/[id].astro:260-271`,
    `src/lib/talent/transitions.ts:16-22`).
12. **Add an undo for Reject.** `REJECTED: []` plus the duplicate-enrollment
    guard (`program-application.ts:15-24, 625-645`) means a mis-click can never
    be corrected through the UI. Allow `REJECTED -> PENDING`.
13. **Close the mobile marketing menu on tap.** Anchor links on `/` do not
    reload, so the panel stays open over the section
    (`PublicLayout.astro:155-159`).
14. **Make the desktop sidebar show the current page.** The active link is
    computed from `window.location` during render
    (`src/components/common/Sidebar.tsx:20`), so the server renders no active
    item, hydration keeps the server's classes, and the desktop rail never
    highlights anything. The mobile drawer, rendered client-side when opened,
    does. Verified in browser on every member and admin page, where React
    also logs a "Prop className did not match" hydration warning for the
    links. Pass the current path down from the layout instead. The chat
    composer has the same class of mismatch on `enterKeyHint` ("send" on the
    server, "enter" on the client).
15. **Show 0:00 instead of "--".** `formatDuration` treats zero as missing
    (`src/lib/recordings/time-utils.ts:8`), so the first transcript segment
    and any chat citation at the start of a recording read "--". Verified in
    browser.

### Phase 1. Member experience (the structural change)

1. **State-aware navigation and a "what's next" dashboard.** Effort M.
   Compute `{enrolled, graduate, hasProfile, published}` in
   `src/layouts/DashboardLayout.astro`, pass it to `DashboardShell`, and show
   only reachable links (or one collapsed "Unlocks after your cohort" row).
   Replace unconditional "Welcome back" (`dashboard/index.astro:26-28`) with a
   single next-step card per state. `ChatApp.tsx:29` derives its rail from
   `DASHBOARD_LINKS`, so it follows automatically.
2. **Merge Profile into one "Public profile" page and drop the review
   state.** Effort M. Name and photo (`dashboard/profile.astro`) join headline,
   bio, skills, links and highlights (`dashboard/portfolio.astro`). Replace
   `submitForReview` with `publishProfile` (sets `publishedAt`); remove
   `IN_REVIEW` from `src/lib/talent/transitions.ts:3-8` and
   `src/components/hire/validation.ts:80-95`; keep `SUSPENDED` and the handle
   lock after publication (`portfolio-handlers.ts:86-105`). The admin
   Profiles list stays as an after-the-fact review queue. This is the same
   policy the blog already uses. While here, persist `githubLogin` from the
   value already fetched at `portfolio.astro:68` so the public GitHub link
   (`talent/[handle].astro:312-322`) finally appears.
3. **Make the profile form keep input and show every error.** Effort S.
   Every input re-renders from the database, never from the submitted form
   (`portfolio.astro:215-383`), so any rejection wipes the edits; overflow
   errors on skills, location and country have no slot and produce a silent
   reload. Mark the handle `readonly` once published instead of failing on
   submit.
4. **Gate Ask AI on having recordings; keep a failed message in the
   composer.** Effort S. Today a user with no cohort sees example prompts
   about mentor hours (verified in browser), and each click persists a
   conversation whose only answer is "No session recordings are available for
   your account yet." (`src/pages/api/chat.ts:183-189`). Add `maxLength=2000`
   to the composer (`src/components/chat/Composer.tsx:67-85`); the server
   rejects longer messages after the composer has already been cleared.
5. **Decide the blog.** Effort S to hide, M to finish. Either add the public
   post page and RSS route that `feed.ts` and `rss.ts` already assume, or hide
   Writing until they exist. Publishing into a void is the worst of both.
6. **Fold highlights into the profile save.** Effort M. The repo picker only
   appears after the form has been saved once (`portfolio.astro:422`), saves
   through a separate fetch with its own toast, and scrolls inside the page
   (`RepoPicker.tsx:316`, `max-h-80 overflow-y-auto`).
7. **Drop the no-script editor.** Effort S. `PlainPostForm.astro` exists only
   as a `<noscript>` fallback for one route in an app where the nav button
   itself is disabled until hydration (`DashboardShell.tsx:63`). Keep the
   Markdown mode and the publish-carries-the-draft form.

### Phase 2. Public surface and forms

1. **Hire form ordering and copy.** Effort S. Validate before the rate-limit
   record; keep "What happens next" visible on success
   (`hire/index.astro:493` hides it exactly when it matters); make budget
   optional since "Prefer not to say" is an option; say "up to 12 skills"
   instead of silently truncating (`validation.ts:50-57`).
2. **Honest contact copy.** Effort S. "Your note is on its way to Amina"
   (`talent/[handle].astro:364-367`) but no email is sent anywhere; the note
   waits in `/dashboard/leads` until the builder logs in. Either send the
   email or say "Amina will see this in her TTV inbox."
3. **Narrow the contact rate limit.** Effort S. Scope `"contact"` is global
   (`talent/[handle].astro:77`), so one recruiter contacting a sixth builder
   in an hour is blocked with "Lots of interest right now". Scope it per
   profile, or raise it, and state the window.
4. **Shrink the directory filter bar.** Effort S. Four selects plus a Filter
   button for a directory of tens (verified in browser with two cards). Keep
   skill and availability, auto-submit on change, or hide the bar under
   twenty profiles.
5. **Homepage placeholders.** Effort S. Dashed "Profile coming" cards labelled
   "Cohort 04 · Kenya", "Cohort 03 · Nigeria"
   (`src/components/homepage/HumansSection.astro:13-18`) read as real people
   next to one real card. Use one neutral placeholder or none.
6. **Certificate legibility on phones.** Effort M, needs browser. Type is
   sized in `cqw` with no floor (`CertificateCard.astro:98-114, 140-141,
   275-277`); at 390px the metadata labels compute to roughly 4px.

### Phase 3. Admin right-sizing

1. **Per-row Approve / Reject on the applications list and the cohort
   roster; retire bulk.** Effort M. Approving one application is: list, scan
   dates for a yellow badge, View, Approve, confirm, land on the same page with
   no message, Back (`applications/[id].astro:62, 229-233`). The roster's bulk
   machinery (90-row cap from D1's parameter limit, a rules paragraph, five
   error codes, all-or-nothing validation, `programs/[id].astro:683-852`,
   `program-application.ts:40-41, 497-623`) serves 11 rows. Keep one "Complete
   all approved" action per cohort that also closes applications.
2. **Drop AUDIT.** Effort S. It adds a third blue button to every pending
   application, a filter pill, a home card and a bulk rule, and is never
   explained anywhere. Keep the enum for stored rows.
3. **Fold Curricula into Cohorts.** Effort M. Two fields, one row, a hard
   dependency ("Create a curriculum before creating a cohort",
   `src/lib/admin/cohorts.ts:99-103`), three pages, a nav item, and a select
   with one option on every cohort form. Auto-select the single row and hide
   the select; drop the nav item.
4. **Group the admin nav.** Effort S. Overview, Applications, Cohorts, People
   (Users + Profiles), Client projects, Recordings, Settings (Integrations,
   Access tokens). `AdminShell.tsx:19-50`, `Sidebar.tsx` gains group headings.
5. **One feedback pattern.** Effort M. Success is silent on application,
   profile, project and recording detail pages and on cohort create; six
   banner spellings across the admin. One `Notice.astro`, `?notice=` after
   every write.
6. **One credential system.** Effort M-L. Agent sessions and PATs duplicate
   label validators, origin helpers, duration lists and tables
   (`src/lib/agent-auth.ts`, `src/lib/personal-access-tokens.ts`), and their
   rules diverge: a write PAT may grant admin and run the legacy import
   (`roles.ts:146-156` and `api/admin/import.ts:40` check only agent
   sessions) but may not even view the PAT page. Keep PATs. Return 401, not a
   302 to an HTML login page, for a rejected bearer token
   (`middleware.ts:30-34, 53-55`).
7. **Delete Data Migration.** Effort S. 467-line page, 773-line library, an
   API route and an e2e spec for a one-time import, disabled in production.
8. **Recordings and Integrations tidy.** Effort M. Make Drive import the
   primary path; the upload form pushes the whole video through an SSR POST
   and loses every field on error (`recordings/upload.astro:14-27, 69-87`).
   "Test connection" only tests enabled sources while new sources start
   paused (`settings/integrations.astro:67-71`, `recordings/import.astro:71`),
   so it cannot exercise a folder during setup. The historical-import preview
   exists only on the POST response (`import.astro:83-92`). Label the two
   transcript textareas (`recordings/[id].astro:131-132`).
9. **Replace index tables with the roster's responsive rows.** Effort M.
   Twelve admin tables sit in `overflow-x-auto`, which on a phone is a second
   scroll surface inside the page scroll. The cohort roster already has the
   right pattern (`programs/[id].astro:689-767`); reuse it.
10. **Terminology sweep.** Effort S. "Program" to "Cohort" in recordings,
    import, home, curricula and two error strings; the Cohorts column
    "Applications" shows Open/Closed; "View Profile" opens the user page;
    "Admin → Settings → Integrations" names a level that does not exist.

### Phase 4. Consistency layer (M in total)

Adopt `Button.astro` everywhere (57 raw `<button>` vs 52 `<Button>` today),
one `Notice.astro`, the `Badge` label map, one date helper (four formats in
the member area, four in the admin), `.form-control` on the six inline-styled
portfolio inputs, `<h2>` page titles everywhere (Opportunities uses an `<h1>`
and its own max-width, `opportunities.astro:125-126`, so the page has two
h1s), and fix `ARCHITECTURE.md`, which says `Button` was deleted while every
dashboard page imports it.

## 4. Persona findings: visitor and hiring client

Routes: `/`, `/blog`, `/talent`, `/talent/[handle]`, `/hire`,
`/certificate/[id]`, `/auth/login`.

**Reachability.** Verified by grep: no `/talent` or `/hire` link exists in any
layout, shell or common component. `/talent` is reachable from the homepage
cohort section only when at least one profile is published
(`HumansSection.astro:74-79`); `/hire` only from `/talent`
(`talent/index.astro:94`). A hiring client's path is Home, "Cohort", scroll,
"See all builders", small text link. Four hops, none labelled hire.

**Blog.** Nav and a footer group point at a page whose content is "Not yet"
(`src/pages/blog/index.astro:38-40`). Meanwhile `feed.ts:2` builds
`/blog/<handle>/<slug>`, `rss.ts:46` advertises `/blog/rss.xml`, the editor
shows authors that URL (`MetadataPanel.tsx:190`), and the Writing list prints
it as plain text (`writing/index.astro:151-154`). None of those routes exist;
`/blog/amina/shipping-my-first-api` returned 404 in the local run.

**Apply.** The orange "Apply" pill targets `/dashboard/apply`
(`PublicLayout.astro:106-111`). The middleware sends anonymous visitors to
`/auth/login` with no return path (`middleware.ts:129-133`); the login page
says "Welcome back" and "Pick up where you left off" (verified in browser);
the GitHub button always lands on `/dashboard` (`GitHubSignInButton.tsx:20`),
where the applicant reads "You haven't applied to any cohorts yet" and clicks
"Browse Cohorts". Three screens to get back to where they started.

**Hire form** (`hire/index.astro`). Guard runs first (`:25-31`) and records the
submission before validation (`spam/protection.ts:101-104`); the form has
`novalidate` (`:243`), so every server-side mistake costs one of five hourly
slots. On a stale token the `prev` object is never filled (`:19, 52-61`) and
all eight fields render empty with "Something went wrong." On success the
page re-renders in place (`:87`) so refresh re-posts, and the "What happens
next" steps disappear (`:493`). Budget is required
(`validation.ts:38-40`) although "Prefer not to say" is a choice. Skills are
silently cut to 12 tags of 30 characters (`validation.ts:50-57`).

**Contact form** (`talent/[handle].astro`). Validates first, then guards
(right order), but the guard-fail branch replaces `formValues` with empties
(`:82-87`). Success copy promises delivery ("on its way to Amina", `:364-367`);
no email is sent, the row waits in `profileContact`. Rate-limit copy blames
demand ("Lots of interest right now", `:373`) for a per-IP limit shared across
every profile on the site.

**Directory** (`talent/index.astro`). Four filter selects, a Filter button and a
Clear link (`:102-191`) rendered above the grid whenever any profile exists;
order rotates daily (`directory-helpers.ts:15-26`) with no explanation, so a
returning visitor cannot find yesterday's card by position.

**Certificate.** No header or footer by design. Type scales with the sheet
width and has no minimum (`CertificateCard.astro:98-114`); on a phone the
labels compute below legibility. "Copy link" silently does nothing when the
clipboard is denied (`CertificateActions.astro:35-40`).

**Login and logout.** `/auth/logout` is a GET with side effects
(`logout.astro:9-13`). Only GitHub sign-in exists (`auth.ts:29-34`) and the
page does not say so before the button.

**Copy and naming.** Blog page has three names (nav "Blog", title "Field
notes", heading "Notes from the cohort."). Nav order How, Why, Cohort differs
from page order Why, What we do, Values, Cohort. Hero CTA "Explore Programs"
scrolls to a section headed "A community, not a course." Placeholder cohort
cards carry invented "Cohort 03 · Nigeria" labels. Five hard-coded "Cohort 04"
and "~25 students" literals will age separately.

## 5. Persona findings: applicant, student, graduate

### Persona x nav matrix

Verified in browser for the new user; the rest from `DASHBOARD_LINKS` and each
page's gate. "Dead" means a lock, an empty state, or a canned answer.

| Link | New sign-in | Applicant (pending / rejected / audit) | Enrolled | Graduate before publish | Graduate published |
|---|---|---|---|---|---|
| Dashboard | "Welcome back", empty card | status card | status card | status card, no certificate | same |
| Sessions | empty | empty | useful | useful | useful |
| Ask AI | example prompts, canned reply persisted | same | useful | useful | useful |
| Apply | open cohorts | other cohorts | marginal | marginal | marginal |
| Portfolio | lock, "Browse Programs" | lock | lock, "Browse Programs" sends them to re-apply | form | form + live link |
| Writing | lock, "Go to Portfolio" (another lock) | lock | lock | "isn't published yet" | posts |
| Leads | "Set up your portfolio first" (another lock) | same | same | "No leads yet" but the public page 404s | leads |
| Opportunities | "Create your profile" (another lock) | same | same | "Once your profile is published" | projects |
| Profile | name + photo | same | same | same | same |
| **Dead links** | **6 of 10** | **6 of 10** | **4 of 10** | **2 to 3 of 10** | **0** |

The ten-item nav is designed for exactly one persona, the published graduate.

### Findings

- **Applicants are asked to write JSON.** `application/[id].astro:146-165`
  renders a `<textarea>` labelled "Application Data (JSON)" while the
  application is pending; invalid input is discarded on error (`:157`
  re-renders the stored value). Non-pending views print `String(value)`, so
  admin-enrolled alumni see `enrollment: [object Object]`
  (`program-application.ts:43-48`).
- **Gates link to other gates.** Writing lock sends to Portfolio; Portfolio
  lock sends to Apply; Leads and Opportunities tell an ineligible user to
  create a profile they cannot create. None checks cohort completion before
  choosing its CTA.
- **IN_REVIEW is a dead end.** Editor hidden with "once the team responds"
  (`portfolio.astro:404-410`); no ETA, no withdraw (the member code only does
  DRAFT to IN_REVIEW, `portfolio-handlers.ts:181`), no notification path in
  code. The review only ever sees the first version because published edits
  go live immediately (`portfolio.astro:159`), and highlights stay editable
  during review because that island is gated on the profile row only
  (`:422`). The admin page for a draft says "Waiting on the builder"
  (`admin/profiles/[id].astro:288`).
- **No way to preview the public page before publishing.** `/talent/<handle>`
  is 404 unless PUBLISHED (`talent/[handle].astro:27-31`).
- **Certificates are unreachable from the member area.** Grep for
  "certificate" under `src/pages/dashboard` and the shells returns nothing.
  The only link is on the public profile, which requires publication. The
  admin confirmation promises "Completing students immediately unlocks their
  certificates" (`program-application.ts:37-38`).
- **Ask AI with nothing to search.** Example prompts about mentor hours and
  customer interviews are shown to everyone (`Transcript.tsx:14-18`); a click
  creates a saved conversation with a canned answer (`api/chat.ts:183-189`).
  Messages over 2,000 characters are rejected after the composer has cleared
  (`api/chat.ts:172-174`, `Composer.tsx:52`), leaving the text stranded in
  the transcript with no retry.
- **Portfolio form loses input on any validation error** (values come from
  the database, `portfolio.astro:215-383`); skills over 30 characters and
  location or country overflows produce a silent reload with no message
  because their errors have no slot (`portfolio-handlers.ts:117-128`).
- **Two saves, two mechanics, one page.** Profile form is a full POST;
  highlights are a fetch with an in-island toast and cannot be chosen until
  the form has been saved once (`portfolio.astro:422`). At phone width the
  draft banner squeezes its sentence into a four-line column beside a
  no-wrap "Submit for Review" button (`portfolio.astro:140-172`). Verified in
  browser.
- **Leads has manual read state.** "Mark Read" and "Archive" are separate
  forms per card (`leads.astro:168-191`); reading a lead requires a click to
  say you read it. Auto-mark on view, or keep only Archive.
- **Apply success strands the user** on the same list with the cohort
  removed (`apply.astro:73, 102-104`); the new application is not linked.
- **Sessions viewer nests a scroller.** Transcript panel is its own
  `overflow-y-auto` inside the page scroll (`TranscriptPanel.tsx:70`,
  `SessionViewer.tsx:42-64`), the pattern the owner dislikes. Verified in
  browser on desktop. On phones the aside has no max height, so with a long
  transcript the video should scroll away while playing; not verified.
- **Opportunities** renders an `<h1>` inside its own max-width wrapper
  (`opportunities.astro:125-126`), so it sits in a narrower column than every
  other page, and a green "Approved" badge on every card that means nothing
  to a builder (`:205`). Verified in browser.
- **Post editor.** First autosave on `/writing/new` gets an id but the URL
  never changes (`PostEditor.tsx:194-198`), so a reload shows a blank editor
  while the draft exists; autosave failures other than slug collisions show
  only "Couldn't save" (`editor-state.ts:154-162`).

## 6. Persona findings: admin and automation

- **Home is a totals board** (`admin/index.astro:37-88`): three "Total"
  counters, an empty fourth grid slot, two linked queues for the rarest work
  (profiles in review, pending projects), and five unlinked application
  counts. Nothing about failed recordings, import errors, or open cohorts.
  Verified in browser, with 13 nav items in a staging-shaped environment.
- **Five-step approval; eight-interaction cohort completion.** Applications
  list has only View; roster has only checkbox bulk with no select-all. Marking
  a cohort complete means ticking each row, setting a date, confirming,
  scrolling up, unticking "Applications open", saving.
- **Irreversible by accident.** `REJECTED` and `COMPLETED` have no exits;
  direct enrollment refuses when any row exists for that user and cohort
  (`program-application.ts:625-645`). The only guard is a browser `confirm()`.
- **Confirmations are inverted.** Every application transition confirms,
  including Audit; Publish, Suspend, project Reject and Close, Remove source,
  Reprocess and Revoke confirm nothing. The enrollment confirm always warns
  about COMPLETED even when APPROVED is selected
  (`programs/[id].astro:621-623`).
- **Silent success.** Application, profile, project and recording detail
  pages and cohort create redirect to themselves with no message; "Save
  Details" and "Save Transcript" give no signal at all.
- **Internal IDs and rules in copy.** "Application <cuid> no longer exists",
  "does not grant admin:write", and the roster paragraph "Approve accepts
  only PENDING or AUDIT rows. Complete accepts only APPROVED rows. A stale or
  cross-cohort selection is rejected in full" (`programs/[id].astro:773`).
  Verified in browser: the roster sits below the details form, the staff
  table and the direct-enrollment form, with a green "Approve selected" and
  a purple "Complete selected" button under that paragraph.
- **Forms that lose input.** Recording upload (every field and the file,
  `upload.astro:69-87`), import-source create (redirect with `?error=`),
  cohort add-role, direct-enroll and bulk selections (full re-render,
  `programs/[id].astro:116-308`).
- **Four views of the same eleven people.** Users, Profiles, Applications,
  and the cohort roster; "View Profile" on an application opens the user page
  (`applications/[id].astro:132-137`), not the profile.
- **Plain-text 403 dead ends.** Three messages with no HTML, nav, or back
  link (`mutation-security.ts:66-72`, `personal-access-tokens.ts:391-397`,
  `middleware.ts:79-89`). The per-page origin checks in the PAT and agent
  pages are unreachable duplicates using a second helper and a softer message
  that can never be shown.
- **Twelve horizontally scrolling tables** (`overflow-x-auto` around
  `w-full`, some with `min-w-[760px]`) on users, applications, cohorts,
  profiles, projects, recordings, PATs, agent sessions, audit log and data
  migration. The e2e overflow checks measure document width, which
  `overflow-x-auto` hides. Verified in browser: at phone width the
  applications table clips its date column and scrolls sideways inside the
  page.
- **The cohort roster header overlaps itself.** At 1280 px the "Learner" and
  "Status" column labels render on top of each other
  (`programs/[id].astro:689-702`). Verified in browser.
- **Status vocabulary.** 30 status words across 7 entities, 16 badge variants
  (`Badge.astro:23-38`), six badge implementations, six error-banner
  spellings, four date formats, program selects sorted three different ways.

## 7. Limits and gates

Verdicts: Keep, Narrow (right idea, too broad), Fix (right value, wrong
behaviour or message), Remove.

| Limit or gate | Value | Where | What the person sees | Verdict |
|---|---|---|---|---|
| Login required for `/dashboard/*` including the Apply CTA | all | `middleware.ts:129-133` | "Welcome back" login, then dashboard home | Fix: carry `next` |
| Portfolio page requires cohort COMPLETED | whole page | `portfolio.astro:23, 27` | lock with "Browse Programs" | Narrow: gate publication, not creation; let students draft during the cohort |
| Profile edits locked while IN_REVIEW | whole form | `portfolio.astro:404-410` | "once the team responds" | Remove the state |
| Writing and Opportunities require PUBLISHED | page | `writing/index.astro:19`, `validation.ts:80` | lock chain | Narrow: follows from removing review; hide links until reachable |
| Leads requires any profile row | page | `leads.astro:22` | "Set up your portfolio first" | Fix the CTA for ineligible users |
| Sessions and Ask AI require APPROVED or COMPLETED, or staff role | list, API | `recordings/access.ts:5-57` | empty list; canned chat reply saved | Keep the rule; gate the chat page and stop persisting canned replies |
| Chat message | 2,000 chars, server only | `api/chat.ts:172-174` | "message is too long" after the composer cleared | Fix: enforce in composer |
| Chat lists | 30 sessions, 100 messages | `chat/sessions.ts:120, 194` | silent truncation | Fix: state it or page |
| Anti-spam token age | 3 s to 2 h | `spam/protection.ts:9-10, 70` | "Something went wrong", form emptied | Fix: keep input, say what happened; 2 h is fine once input survives |
| Public form rate limit | 5 per hour per IP per scope | `spam/protection.ts:11, 88-99` | hire: "Too many submissions"; contact: "Lots of interest right now"; form removed | Narrow: hire counts failed validations; contact scope is site-wide; both hide a 60-minute window |
| Hire budget | required enum with a "Prefer not to say" option | `validation.ts:38-40` | "Please select a budget range." | Remove the requirement |
| Hire skills | 12 tags x 30 chars, silent | `validation.ts:50-57` | nothing | Fix: say it |
| Handle | 3 to 39, lowercase, reserved words, locked after publish | `handles.ts:46-69`, `portfolio-handlers.ts:86-105` | lock discovered on submit | Keep; make the input `readonly` |
| Headline, bio, location, country | 120 / 4,000 / 120 / 56 | `profile.ts:14-17` | two of four errors never rendered | Keep; fix error slots |
| Skills on profile | 12 x 30 | `profile.ts:11, 18` | raw zod text or silence | Fix messages |
| Profile URLs | 300 chars, must be https | `profile.ts:3-9` | "URL must use HTTPS", then the form wipes | Narrow: accept http or upgrade it |
| Highlights | 6, blurb 500, repo list capped at 100 most recent | `RepoPicker.tsx:32-33`, `github.ts:72-76` | counter; older repos absent silently | Keep; mention the 100 |
| Post | title 200, body 40,000, excerpt 300, slug 80 | `post.ts:3-7`, `slug.ts:4-12` | rich mode has no body cap, so "Couldn't save" with no reason | Fix: surface the error |
| Avatar | 5 MB, resized to 1024, WebP | `avatar.ts:3-27` | clear messages | Keep |
| Bulk selection | 90 rows, all-or-nothing | `program-application.ts:40-41, 590-614` | "Select at most 90", batch voided by one wrong tick | Remove with bulk |
| Application transitions | REJECTED and COMPLETED terminal | `program-application.ts:15-24` | no undo | Fix: add REJECTED to PENDING |
| PAT count, label, lifetime, scope | 10 active, 50 chars, 8 h to 30 d, read/write | `personal-access-tokens.ts:4, 9, 74-99` | clear | Keep; align durations with the one credential system that remains |
| Delegated credentials on the PAT page | blocked even for GET | `middleware.ts:75-89` | plain-text 403 | Keep the rule; render a page |
| Expired or invalid PAT | no cookie fallback | `middleware.ts:30-34` | 302 to an HTML login page | Fix: 401 |
| Admin mutation origin | all unsafe methods | `mutation-security.ts:57-73` | plain-text 403 | Keep; render a page; delete the unreachable per-page duplicates |
| Completion date | not after server-UTC today | `program-application.ts:140-181` | "cannot be in the future" | Keep |
| Cohort requires curriculum | hard FK | `cohorts.ts:99-110` | "Create a curriculum before creating a cohort." | Remove with the entity |
| "Test connection" | enabled sources only | `integrations.astro:67-71` | passes while the new, paused source is untested | Fix: test all |
| Recording upload size | none in code | `upload.astro:14, 27` | Workers body limit failure | Remove the path or add a limit and a message |
| Cookie cache | 5 min | `auth.ts:39-42` | up to 5 min stale role after a change | Keep |

## 8. Consistency inventory

Counts from grep on `main`:

| Pattern | Count |
|---|---|
| Raw `<button>` vs `<Button>` component | 57 vs 52 |
| Inputs on `.form-control` vs inline class strings (portfolio) vs bespoke (hire, contact) | 50 vs 6 vs 2 forms |
| Status words across entities | 30 (applications 5, profiles 4, posts 3, projects 5, interest 2, leads 3, recordings 8) |
| Badge variants | 16, rendered from the raw variant string |
| Badge implementations | 6 |
| Success/error banner spellings | 6 in admin, 6 in member area |
| Date formats | 4 member, 4 admin |
| Names for the person | builder, talent, student, learner, alumni |
| Names for the cohort | cohort, program, curriculum title |
| Names for the public page | portfolio, profile, portfolio profile, builder profile, /talent |
| Member nav items | 10, none gated |
| Admin nav items | 11 to 13, flat |
| Desktop sidebar active state | none on any page (mobile drawer only) |

## 9. Keep as is

- The immersive layout for Ask AI and the editor: one scroll region,
  composer pinned, keyboard handled. Reuse it, do not redesign it.
- The publish-carries-the-draft form in the editor, and Markdown as the
  source of truth.
- The atomic SQL in `program-application.ts` and the concurrency guards.
  Keep the mechanism, cut the copy it emits.
- The handle lock after publication; the 39-character handle; the avatar
  pipeline; the certificate route and its screen-first design.
- Curricula's form pattern (values preserved, field errors, PRG with
  `?notice=`) is the model for every other admin form.
- The cohort roster's responsive row layout is the model for every table.
- The spam guard mechanism (honeypot, signed token, per-IP count). Only its
  ordering, scope and messages need work.

## 10. Decisions needed from the owner

1. Blog: finish the public post page, or hide Writing until it exists?
2. Profile review: drop pre-moderation and publish on the member's action
   (recommended), or keep it and add withdraw plus an ETA?
3. AUDIT status: is it still used? If not, retire it.
4. Curricula: keep as a separate entity, or fold into cohorts?
5. Agent Access: retire in favour of PATs?
6. Data Migration: has the legacy import happened? If so, delete.
7. Recording upload: keep alongside Drive import, or remove?
8. Contact relay: send the email, or change the promise?
9. Hire form: is budget genuinely required?
10. Leads: keep the manual "Mark Read", or auto-mark on view?

## Appendix A. Method

- Three full-read audits (public, member, admin), each covering every file
  on its routes plus the e2e journeys that document intent, then
  spot-checked against the source before inclusion.
- A local run: `npm run db:migrate:local`, a seed with one account per
  persona (new sign-in, pending applicant, enrolled student, graduate without
  a profile, graduate in review, published builder, rejected applicant,
  admin) plus cohorts, recordings, leads, posts and client projects, and
  bearer-token sessions so Playwright could render every route as each
  persona at 1280 px and on a Pixel 7 profile. Requires the two temporary
  `wrangler.jsonc` edits described in the project knowledge (remove the AI and
  Vectorize bindings, disable containers) and `AGENT_AUTH_ENABLED=true` in
  `.dev.vars`; none of that is committed.
- Claims marked "needs browser" in the persona sections were not confirmed
  visually: certificate type size on phones, transcript panel height on
  phones with a long transcript, and the recording upload size failure on
  Cloudflare.
