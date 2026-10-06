# Student experience review

Reviewed 2026-10-06 against `main` at `3f804e6`. Scope: everything a student
touches, from the homepage to a published profile with a post. I drove the
app locally with eight seeded students, one per state (new sign-in, pending,
audit, rejected, enrolled, graduate with no profile, graduate in review,
published builder). Each route was captured at 1280 px and on a Pixel 7
profile, and four flows were run end to end. Paths are relative to `web/`.

The September review (`docs/ux-simplification-review.md` on branch
`sam/feel-things-system-overly-zv9jd2`, never merged) covered every persona.
This review covers students only and re-checks that review's findings
against current `main`. Since September, three of them have been fixed:

- the login round trip,
- the blog reader,
- Ask AI for students without recordings.

Everything else on the student path still stands.

Screenshot file names below refer to the captures taken for this review.
They contain seeded test data only.

## 1. The short version

There are three problems, in this order of cost.

**1. Too many barriers.** A student passes three human approvals, and spends
about four months, before they can publish one public sentence about
themselves. Nobody tells them when any of those approvals happens, because
the app cannot send email. Each approval unlocks a different set of pages,
but all ten pages are in the menu from the first sign-in. For six of those
pages, a new student gets a padlock, an empty card, or a link to another
padlock.

**2. The dashboard does not look like Tembo.** The public site, blog, talent
pages, Ask AI and the writing editor share a confident editorial look:

- Mattone display headings
- tracked small caps for labels
- cream on deep teal
- orange pill buttons

The dashboard, where students actually spend their time, looks like a stock
admin template:

- the title is "TTV Dashboard" in plain bold text
- flat teal-on-teal cards sit in a mostly empty canvas
- small square buttons
- pastel status badges in purple, blue and cyan, which are not brand colours
- dates in US format, so "4/2/2027" reads as 4 February in Nairobi

**3. Bugs that fail without saying anything.** Two of them destroy work:

- Saving a profile with one skill over 30 characters reloads the page, shows
  no error, and erases every field, including the bio. Reproduced in a
  browser (`73-flow-profile-error-desktop.png`).
- The public contact and hire forms erase everything that was typed if they
  are submitted within 3 seconds (easy with autofill) or after 2 hours.

Most of the fix is subtraction:

- show only the pages that apply to the student's state
- move the portfolio and writing gates earlier
- replace the profile review queue with publish-then-check

Clef can do the "check" in publish-then-check. It lets you delete the review
waits without moving the risk onto students or admins (section 5).

## 2. The journey today

| Step | What the student does | Who unblocks it | How they find out |
|---|---|---|---|
| 1 | Signs in with GitHub (the only option) | Nobody | Immediately |
| 2 | Clicks Apply on a cohort card. Nothing is asked. | Nobody | A green banner over "No cohorts are accepting applications right now" (`70-flow-after-apply-mobile.png`) |
| 3 | Waits on **Pending**. The application page offers a raw JSON textarea containing `{}` (`21-pending-application-desktop.png`). | An admin approves | Only by signing in again and noticing the badge has changed |
| 4 | **Approved**: Sessions and Ask AI unlock. The dashboard still shows only the application card, with no pointer to either (`30-enrolled-dashboard-mobile.png`). | Nobody | Nothing says so |
| 5 | Takes the cohort, about 12 weeks | An admin marks them **Completed** | Nothing says so. There is no certificate link anywhere in the dashboard. |
| 6 | Portfolio unlocks. Fills in the profile and submits it for review. | An admin publishes | The badge reads "In_review". Editing is locked "once the team responds" (`50-review-portfolio-mobile.png`). |
| 7 | Profile is **Published**: Writing, Opportunities and Leads unlock | Nobody | Nothing says so |

The first public, shareable thing a student gets is a profile at step 7.
Writing a post, the cheapest way to show progress and the best fit with the
"community" pitch on the homepage, sits behind every gate.

Some states are worse:

- **Audit** gets nothing. `getAccessibleProgramIds` only counts APPROVED and
  COMPLETED (`src/lib/recordings/access.ts:10`). An auditing student cannot
  see the sessions of the cohort they are auditing. The badge says "Audit"
  with no explanation (`24-audit-application-mobile.png`).
- **Rejected** shows a red badge and "No additional details submitted."
  There is no reason, no next cohort and no next step.
- **An enrolled student** who clicks Portfolio is told it unlocks when they
  complete a cohort, then gets a "Browse Programs" button that sends them to
  apply again (`src/pages/dashboard/portfolio.astro:122`).

### Dead links per state

A dead link is a page that shows a lock, an empty state, or a link to
another lock.

| State | Live | Dead |
|---|---|---|
| New sign-in, pending, rejected, audit | Dashboard, Apply, Profile, Ask AI (general questions only) | Sessions, Portfolio, Writing, Leads, Opportunities |
| Enrolled | + Sessions, full Ask AI | Portfolio, Writing, Leads, Opportunities |
| Graduate, no profile | + Portfolio | Writing, Leads, Opportunities |
| Graduate, in review | (Portfolio becomes read-only) | Writing, Leads, Opportunities |
| Published | all ten | none |

## 3. Barriers, ranked by how much removing them unlocks

Each entry gives the evidence, the change, and whether Clef is involved.

### B1. One menu for every state (still true from September)

`DASHBOARD_LINKS` is static (`src/components/shells/DashboardShell.tsx:21-32`),
and the shell receives no information about the user.

**Change.** Pass `{ status, hasProfile, published, unreadLeads }` from
`DashboardLayout.astro` and render only the links that apply:

- **Before acceptance:** Home, Apply, Ask AI, Account.
- **Enrolled:** adds Sessions.
- **Profile allowed:** adds Profile, Writing, Opportunities and Leads (B3
  moves this earlier).

Show the unread lead count on Leads. Nobody notices a lead today unless
they open that page.

### B2. The dashboard home does not say what to do next

Every state gets "Welcome back, {name}. Manage your applications and track
your progress." plus a list of application cards
(`src/pages/dashboard/index.astro:26-31`).

**Change.** Make home one "next step" card per state, each with a single
button:

| State | Card says | Button |
|---|---|---|
| No application | The open cohort, with dates in plain words | Apply |
| Pending | "We read every application. Most people hear back within N days." | Edit answers |
| Audit | What audit means and what you can access | Watch sessions |
| Rejected | Encouragement that does not condescend, and when the next cohort opens | Join the waitlist or read the blog |
| Enrolled | This week's session and an Ask AI prompt | — |
| Completed | Certificate and profile | View certificate, then Build your profile |
| Published | Unread leads, new opportunities, drafts | — |

Show "Welcome back" only from the second visit.

### B3. Portfolio and Writing wait for graduation

Gate: `hasCompletedCohort` (`src/lib/talent/eligibility.ts:18-32`), then a
published profile (`src/pages/dashboard/writing/new.astro:31`).

**Change.** Open the profile and Writing to approved students on day one
of the cohort. A profile that grows during the cohort is worth more to the
student, and to anyone hiring, than one written in a rush after
graduation. Keep "Verified by TTV · Completed" on the public profile as the
thing graduation adds; the badge already exists
(`05-talent-amina-mobile.png`). The risk this adds is unreviewed public
content from more people. Clef handles that (C1, C2).

### B4. Profile review queue: pre-moderation with no feedback

The status flow is DRAFT → IN_REVIEW → PUBLISHED. IN_REVIEW locks the form
for an unbounded time ("You'll be able to edit it again once the team
responds", `portfolio.astro:407`). There is no column for a reviewer's note
and no notification. After the first publish, edits go live without review,
so the queue only ever checks version one.

**Change.**

1. Publish on submit, after a Clef check (C1).
2. Hold only flagged profiles for a human, and tell the student which
   checks flagged it.
3. Delete IN_REVIEW, the lock, and the "Profiles awaiting review" queue.
4. Keep the admin's "Unpublish" for anything that slips through.

### B5. Nobody is ever told anything

The app has no way to send email. Three human decisions in the journey
(approve, complete, publish) and every incoming lead depend on the student
signing in again by chance.

**Change.** Owner action: enable Cloudflare Email Service. The project notes
already prefer it; it costs about $0 at TTV's volume. Then send four
messages: application received, accepted, completed (with the certificate
link), and new lead. Nothing else in this review gains as much per line of
code.

### B6. The application asks nothing, then offers JSON

Apply stores `application: "{}"` (`src/lib/admin/program-application.ts:361`).
The pending page then shows "Application Data (JSON)" with
"Enter your application details as JSON."
(`src/pages/dashboard/application/[id].astro:146-165`). This barrier is
not the form being too long. Admins have nothing to decide on, so decisions
are slow and, for the student, opaque.

**Change.** Four or five plain questions, as in the September review:

- what you have built
- which of these you have used (checkboxes)
- what you want to build
- how many hours a week you have

Delete the JSON editor. Clef can give gentle completeness hints before
submit (C4). It must not score people.

### B7. GitHub is the only way in

`/auth/login` says "A GitHub account is required to sign in and continue."
For someone at the very start, that means creating a developer account
before they can find out whether they are eligible.

**Product call.** Either keep GitHub, which fits the "builders" identity
and powers highlights, and say on the homepage, before the click, that it
takes two minutes. Or add email sign-in and ask for GitHub at the
Profile step, where it is used.

### B8. Smaller barriers

- **Sessions** shows pipeline states to students: "Failed", "Transcribing",
  and "--" for duration (`31-enrolled-sessions-desktop.png`). Show students
  complete recordings only, and "Processing" for anything else.
- **Ask AI**'s composer says "Ask about your sessions…" to students who
  have none (`17-new-ask-desktop.png`).
- **Opportunities** shows the admin word "Approved" on every client
  project (`64-pub-opportunities-mobile.png`).
- **After applying**, the page shows the success banner above "No cohorts
  are accepting applications right now. You may already have applied to
  every open cohort." Redirect to the application's page and its next-step
  card instead.
- **The certificate is unreachable** from the dashboard. The only link to
  it is on the public profile, so you need a published profile to find it.

## 4. Beauty and usability

### What is working

- **Homepage, blog, talent profiles.** They hold up well on both widths.
  The type scale, the "§ 00 WHY TEMBO" labels and the generous spacing
  give the site a voice.
- **Ask AI and the writing editor.** The two newest member surfaces, and
  the best-looking ones: full-bleed, one clear action, no chrome
  (`74-ask-mobile.png`, `77-writing-editor-desktop.png`). The dashboard
  should be heading in this direction.
- **The certificate.** Calm and legible (`45-grad-certificate-desktop.png`).

### What is not

1. **Two products.** The dashboard shell shares the palette with the
   public site but none of its typography or rhythm:
   - The menu title is "TTV Dashboard" in bold sans on desktop but in
     Mattone on mobile, because the mobile header is an `<h1>`. Mobile
     pages therefore have two `<h1>` elements.
   - The Tembo wordmark appears nowhere.
   - Replace the title with the public header's `TEMBO · TECH VENTURES`
     lockup, and use the public eyebrow-label pattern for section labels.
2. **Empty canvases.** Most member pages, for most students, are one
   centred card in a 1000 px void (`10-new-dashboard-desktop.png`,
   `12-new-portfolio-desktop.png`). The next-step home (B2) fixes the most
   visited one. For the rest, hiding the page beats styling its lock.
3. **Three button styles:**
   - small rounded rectangles in sentence case on most pages
   - the public uppercase pill on Opportunities ("RAISE YOUR HAND",
     "CREATE YOUR PROFILE")
   - outline chips on Leads

   Pick the pill for primary actions everywhere, since it is the brand's
   button.
4. **Badge colours outside the brand.**
   - Badges: yellow Pending, blue Audit, purple Completed, cyan New.
   - Banners: a blue info box, plus green and amber panels in Tailwind's
     default shades.
   - Raw enum text: "In_review".

   Use one neutral pill plus orange for "needs you" and teal for "done",
   with words a person would say: "Under review", "You're in",
   "Graduated".
5. **Dates.** `toLocaleDateString()` with no locale renders in the
   Worker's default, en-US: "Starts 1/11/2027 — Ends 4/2/2027"
   (`src/pages/dashboard/apply.astro:143-144`,
   `application/[id].astro:120-136`, `index.astro:54`). Writing and Leads
   already use "Oct 6, 2026". Use that format everywhere: it cannot be
   misread.
6. **The current page is never highlighted** in the desktop menu. Active
   state is computed from `window.location` during render
   (`src/components/common/Sidebar.tsx:20`). The server renders nothing as
   active, and React logs "Prop className did not match" on every
   dashboard page (seen in all 34 desktop captures) and keeps the server's
   classes. The mobile drawer does highlight, because it renders after
   hydration (`72-flow-mobile-menu.png`).
7. **The profile form is long and silent on mobile.**
   - The handle stays editable after publishing, and the change is
     rejected only on submit.
   - Skills are a comma-separated string with an invisible 30-character
     limit.
   - Errors have no slot (see section 6).
   - Show the handle as text once published. Use chips for skills, with
     the limit enforced as the student types.
8. **A grey slab under "Latest posts".** The homepage's "Latest posts"
   shows a large grey slab whenever there are fewer than three posts
   (`home-desktop-s06.png`). The list is a 3-column grid with `gap-px`
   over a `bg-rule` background (`src/pages/index.astro:72`). Empty cells
   show the rule colour, so one post reads as one card plus a broken
   image. Size the grid to the number of posts.

## 5. Where Clef helps

[Clef and Clef-flash](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/)
are Cloudflare's decision models on Workers AI (`@cf/cloudflare/clef`,
`@cf/cloudflare/clef-flash`, Apache 2.0). You send a document (`state`), up
to 64 typed questions, and up to four images. Each question is yes/no
(`noul`), a named choice, or an ordinal score. For every allowed answer you
get back a probability, and nothing free-form to parse. Clef-flash is 9B
parameters, about 40 ms median latency, and
[$0.09 per million input tokens](https://developers.cloudflare.com/workers-ai/models/clef-flash/).
At TTV's volume of tens of profiles, posts and messages a month, the cost
rounds to zero. It runs through the
existing `env.AI` binding and AI Gateway, so there is no new vendor.

The useful framing: **a classifier lets you delete a human wait without
deleting the safety it provided.** Design rules, so it unlocks rather than
adds a new gate:

- **Pass by default.** The model can only send something to a human; it
  never rejects a student on its own.
- **On failure, publish and flag.** Fail open to the queue, not closed.
  If Workers AI is down, publish and mark the item for a human to check
  after the fact.
- **Fixed questions in code, fixed messages to the student.** For example
  "Your bio mentions a phone number; public profiles can't include one".
  Never show model output to the student.
- **Keep a record.** Store probabilities with the item so an admin can see
  why it was held, and so thresholds can be tuned on real data.
- **Never score people.** No ranking of applicants and no judging of
  ability. Those are decisions for the team.

### C1. Profile publish check (replaces the IN_REVIEW queue)

On "Publish", ask Clef-flash about the profile JSON and the avatar image:

- `contains_contact_details` (noul): phone, email or national ID in a
  public field
- `abusive_or_sexual` (noul)
- `promotes_unrelated_business` (noul): spam or MLM
- `impersonation_risk` (noul): bio claims to be TTV staff or a company

All clear: publish immediately. Any flag: hold, show the student which
check flagged it, and let them edit and resubmit straight away. This
removes B4 and makes B3 safe.

### C2. Post publish check (makes earlier Writing safe)

Same pattern for posts, plus `mostly_promotional` (noul) and
`topic_fit` (choice: learning log / project write-up / career /
off-topic). Flagged posts stay as drafts with a short reason, and admins
see a "held" list. `blogPost.adminNote` and SUSPENDED already exist, so
this needs no schema change.

### C3. Contact and hire form spam (replaces the 3-second token)

The anti-spam token is what erases form input. Replace it with the
honeypot (keep it), the hourly cap (keep it), and Clef-flash on the
message:

- `spam` (noul)
- `scam_pattern` (noul): advance fee, "pay to get hired", crypto
  recruitment. Early-career developers are a known target.
- `genuine_inquiry` (choice: hiring / collaboration / question / other)

Spam is dropped silently. A scam pattern is delivered with a warning
banner on the lead. The hire form can then accept immediately, and
`clientProject` PENDING only needs a human when Clef is unsure.

### C4. Application completeness hints (not scoring)

Once B6 exists: before submit, ask `answer_is_placeholder` (noul) and
`project_description_specific` (score: vague / some detail / specific)
for the free-text answers. If an answer looks thin, show a nudge under it
("Add a sentence about what it does"). The student can still submit, and
the result never reaches the admin view.

### C5. Ask AI routing

Before calling the 20B chat model, a Clef-flash `intent` choice (session
content / my application / programme info / coding help / off-topic or
abuse) can:

- pick the tool set
- set the placeholder and suggestions
- refuse abuse cheaply

Optional. The chat works today, but this is the cheapest quality gain for
the top product priority.

### Where not to use it

- **Approving applications or marking completion.** Those are judgments
  about people, not content.
- **Anything that silently hides a student's work** without telling them
  why.

One open question for the Swahili and French test: language coverage is
not documented. Before relying on C1–C3, run a few Swahili and French
samples.

## 6. Bugs found on the way

| # | Bug | Evidence |
|---|---|---|
| 1 | Profile save with an invalid field erases every input and shows no error | `73-flow-profile-error-desktop.png`; inputs re-render from the database (`portfolio.astro:214-382`); skill, location and country errors have no slot |
| 2 | Contact and hire forms lose all input on a token failure | `src/pages/hire/index.astro:52-61`, `src/pages/talent/[handle].astro:107-111`, `MIN_FILL_SECONDS = 3` |
| 3 | Desktop menu never shows the current page; hydration warning on every dashboard page | `Sidebar.tsx:20` |
| 4 | Audit students cannot see their cohort's sessions | `access.ts:10` |
| 5 | Status badge shows "In_review" | `Badge.astro:46-50` |
| 6 | "Submit for Review" success says "Profile saved successfully." | `portfolio.astro:184-188` |
| 7 | Ambiguous M/D/Y dates in four dashboard pages | section 4, item 5 |
| 8 | The mobile dashboard header is an `<h1>`, so every page has two | `DashboardShell.tsx:69` |
| 9 | Chat API errors shown verbatim ("message is too long") | `src/pages/api/chat.ts:85-88` |
| 10 | "Latest posts" grid shows a grey slab with fewer than 3 posts | `src/pages/index.astro:72` |

## 7. Suggested order

Each step can ship alone, and the earlier ones make the later ones
cheaper.

1. **Quick fixes (S).**
   - Bugs 1–8.
   - Hide pipeline states from Sessions.
   - Link the certificate from the Completed card.
2. **State-aware menu and next-step home (M).** B1, B2. This is the
   biggest perceived change.
3. **Dashboard visual pass (M).**
   - The Tembo lockup.
   - One button and one badge system.
   - Eyebrow labels.
   - Date format.
4. **Email (S, after the owner enables it).** B5.
5. **Clef checks for profile and post (M).** C1, C2, then remove the
   IN_REVIEW queue (B4).
6. **Open Profile and Writing to enrolled students (S once 5 has
   landed).** B3.
7. **Application questionnaire (M).** B6, with C4 hints.
8. **Spam check on public forms with Clef, and drop the timing token
   (S).** C3.

## 8. Decisions (owner, 2026-10-06)

1. **Profile** still unlocks when a student completes a cohort.
   **Writing** unlocks when a student is accepted. This replaces B3's
   proposal. Posts therefore need a byline that does not depend on a
   published profile.
2. **Audit** students get session recordings and Ask AI over them.
3. **Sign-in** stays GitHub-only (B7 closed). Say on the homepage, before
   the click, that a GitHub account is needed.
4. **Email.** The owner is enabling Cloudflare Email Service, which
   unblocks B5.
5. **Publish-then-check** with Clef replaces human pre-review of profiles
   (C1, B4).

## Appendix. Method

- **Local setup.** Astro dev server on `127.0.0.1`, with the AI and
  Vectorize bindings and containers removed from `wrangler.jsonc`.
  `AGENT_AUTH_ENABLED=true` in `.dev.vars`. Migrations applied to local
  D1, plus a hand-written seed:
  - one user and bearer session per state
  - three cohorts (closed, open and past)
  - five recordings in mixed pipeline states
  - two profiles, two highlights, two posts, one lead, one approved
    client project

  None of this is committed.
- **Captures.** Playwright, 43 routes × 2 viewports, plus four flows:
  - applying as a new user
  - opening the mobile menu
  - saving a profile with an invalid field
  - opening the editor
- **Fonts.** Google Fonts are proxied through Node, because the container's
  Chromium cannot reach them directly. Without that, every capture
  renders in a fallback font.
- **Not product bugs.** Full-page captures show GSAP sections as blank and
  the sticky sidebar as cut off. Both were checked against scrolled
  viewport captures (`home-desktop-s0*.png`). The session video 404s and
  the missing transcript come from seed data with no R2 objects. GitHub
  highlights show "couldn't reach your GitHub account" because the seed
  has no OAuth token.
