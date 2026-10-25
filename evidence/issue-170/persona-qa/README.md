# Exploratory persona QA on staging (fictional data only)

**What:** hands-on Playwright browser testing (click/type/navigate/back/refresh, desktop 1366×860 and mobile 412px) of `staging.tembotechventures.com`. I tested as four clearly fictional demo personas and as an anonymous visitor.

**Builds and actual capture times (UTC, 2026-10-25):**
- Public visitor pass on `6d6d706`: 11:03:39–11:08:37.
- Signed-in persona pass on `5ee8249`: 12:22:11–12:31:50, about 10 minutes.

**Access:** an owner-approved, single-use, staging-only QA access mechanism. Four fixed fictional personas: institution, mentor, cohort member and non-cohort member. Sessions lasted at most 60 minutes, were issued once with no renewal, and were revoked and cleaned up afterwards. No real users, credentials or production systems were involved.

**Not tested:** any AI/GLM path ("Order by published evidence", "Assess evidence", "Ask about the work", Ask AI). This report makes **no claim about ranking, grounding or candidate-quality accuracy**.

### Findings

| ID | Severity | Who | Finding |
|---|---|---|---|
| M1 | **High** | Mentor → Institution | The same mentor can confirm the same claim revision more than once. Each copy appears to institutions as a separate "Checked by", which inflates apparent corroboration. Expected: one confirmation per mentor per revision. |
| I1 | Medium | Institution, Mentor | Discover and Mentor review **are reachable** via Dashboard → Community → the top navigation. However, the dashboard home and sidebar have no direct entry, and the home suggests "Find your next cohort". |
| I2 | Medium | Institution | Discover keeps state only in the page. Browser Back from an open profile leaves Discover, and Forward or refresh loses the criteria and results. |
| I3 | Medium | Institution | Searching with no skills shows 50 of 149 profiles alphabetically, with no paging or "showing 50 of 149" note. |
| M2 | Medium | Member | A contribution dated in the future (2027-01-01) is accepted and listed first everywhere. |
| M3 | Medium | Member | Members can't edit or delete their own contributions. |
| M4 | Medium (demo UX) | Members | **QA-access-specific.** Routes outside the persona allow-list (Apply, Ask AI, Account, and the cohort home's "Watch sessions") correctly return 403. But the denial is a bare text page, "…unavailable or expired", with no layout or way back, while the nav still offers those links. The boundary is correct; the presentation and wording are the issue. Whether the human `/demo` personas see the same thing hasn't been verified. |
| F2 | Medium | Public recruiter | `/hire` → "Meet the builders" leads to an empty `/talent` "Coming soon" page on staging. |
| I4/M5 | Low | All | The first word of the display name is used as the first name: "Explore Fictional's work", "Welcome back, Fictional". |
| I6 | Low | Institution | "1 entries"; opening a profile takes about 2–3s with only an inline "Opening profile…". |
| F1 | Low | Public | The `/community#institutions` anchor heading lands under the sticky header. |
| M8 | Low | Members (mobile) | The mobile community header omits "Dashboard ↗"; the logo still links to the dashboard. |

**Usability suggestions:**
- Public pages give no way to request institution or mentor access.
- `/hire` and institutional discovery read as competing recruiter paths.
- Discover result cards are identical apart from the name and are numbered, which reads like a ranking.
- Members have no way to ask for a mentor review.
- The mentor workspace is one long, unfiltered list with a full form on every claim.

### Verified working
- Role boundaries: institution sees Discover only, mentor sees Mentor review only, members see neither, and no persona can reach `/admin` or `/demo`.
- Anonymous visitors are redirected to sign-in.
- Search: Kotlin returns 15; React+Kotlin returns 0; nonexistent skills return 0 with a clear empty state and recovery; inputs are normalized; script input is inert. The mentor is excluded from discovery.
- The profile keeps member claim, member-attached source and mentor confirmation (role at time, method, revision, date) distinct. Missing evidence is labelled "not a negative assessment".
- Forms validate; drafts persist; double-clicking Save sends one request.
- Signing out one persona leaves the others valid. After sign-out, Back shows no cached private content.
- No horizontal overflow at 412px on the tested pages.

### Screenshots (15 PNGs, inspected before publishing; fictional data only)

| What it shows | Viewport | Captured (UTC) | Image |
|---|---|---|---|
| Institution dashboard: no Discover entry on home/sidebar (I1) | Desktop | 12:22:11 | [001-auth-first.png](personas/001-auth-first.png) |
| Institution Kotlin scout results: identical cards, "Explore Fictional's work" (I4/I5) | Desktop | 12:23:09 | [008-inst-scout-kotlin-results.png](personas/008-inst-scout-kotlin-results.png) |
| Institution Kotlin results on mobile | Mobile 412px | 12:24:53 | [022-m-inst-results.png](personas/022-m-inst-results.png) |
| Profile evidence: claim / source / mentor confirmation kept distinct | Desktop | 12:23:37 | [010-inst-profile-david-wait.png](personas/010-inst-profile-david-wait.png) |
| Browser Back from an open profile exits Discover (I2) | Desktop | 12:23:50 | [011-inst-after-back.png](personas/011-inst-after-back.png) |
| Cross-role journey + duplicate confirmation: member's new entry seen by institution with two confirmations from the same mentor on Revision 1 (M1, M2) | Desktop | 12:29:27 | [036-inst-sees-qa-entry.png](personas/036-inst-sees-qa-entry.png) |
| Mentor workspace with the run-tagged claims (mentor side of the journey) | Desktop | 12:28:23 | [031-mentor-home.png](personas/031-mentor-home.png) |
| Mentor review form on mobile | Mobile 412px | 12:30:13 | [038-m-mentor-scroll.png](personas/038-m-mentor-scroll.png) |
| Cohort member journey on mobile | Mobile 412px | 12:30:18 | [039-m-cohort-top.png](personas/039-m-cohort-top.png) |
| Raw QA allow-list 403 page (M4: boundary correct, presentation not) | Desktop | 12:27:01 | [026-noncohort-discover-denied.png](personas/026-noncohort-discover-denied.png) |
| Public: /community#institutions heading under the sticky header (F1) | Desktop | 11:05:27 | [006-inst-pub-community-institutions.png](public/006-inst-pub-community-institutions.png) |
| Public: institution FAQ, with no way to request access | Desktop | 11:05:47 | [008-inst-pub-faq.png](public/008-inst-pub-faq.png) |
| Public: /talent "Coming soon" dead end from /hire (F2) | Desktop | 11:06:07 | [012-pub-talent.png](public/012-pub-talent.png) |
| Public: institutions page on mobile | Mobile (Pixel 7) | 11:06:29 | [015-m-pub-institutions.png](public/015-m-pub-institutions.png) |
| Public: anonymous /demo gets a clear 401 page | Desktop | 11:06:41 | [017-pub-demo-401.png](public/017-pub-demo-401.png) |

**Limitations:** These are still screenshots, not recordings. **No video was captured** during this run. A still image shows the state at one moment; it doesn't prove the whole interaction (clicks, timing, network). The step-by-step actions and observed HTTP results are described above. The persona sessions have expired and been revoked, so new recordings would need a separately approved session.

Mobile captures of signed-in pages used a resized desktop Chromium viewport (412px wide), not a mobile device profile. The public mobile capture used the Pixel 7 profile.
