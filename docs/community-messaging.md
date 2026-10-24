# Community messaging and discoverability

Marketing evidence refresh draft, 2026-10-24. Audited integration revision:
`144367fab48be597f00b64a50dd4fff748522f9d` on
`sam/use-sam-mcp-tools-m8a3jp`, integration PR #171, evidence issue #170.
This records implemented source and proposed messaging, not a declaration that
the integrated feature is live or accepted. The original audit used `d60a331`;
this refresh follows backend #182 and UI #185 integration.
Designer owns runtime UI and tests; Marketing owns claims and copy review.
PM owns integration and serialized staging verification.

## Positioning

**Let your work tell your story.**

A community for TTV students and builders beyond our cohorts. Bring your
projects and contributions into one journey, with supporting links and mentor
confirmations.

For institutions: **Understand the work behind a profile.** Approved
institutional accounts can explore community profiles, contributions and the
evidence members share. Hiring is the first use case; account access remains
generic and does not promise employment or other opportunities.

Use TTV's established dark teal/green and peach, typography and voice within
the new polished structure. Emphasize community and agency; avoid savior
framing. No upvotes, universal trust scores or inferred ability ratings.

## Implementation-backed claims matrix

“Code present” below means inspected source at the revision above. It does
not mean authenticated staging or production behavior has been verified.

### Evidence ledger

| Evidence level | What is established | Limit |
| --- | --- | --- |
| Integrated source | Backend #182, public entry, visibility notices and assessment UI #185 are integrated at `144367fab48be597f00b64a50dd4fff748522f9d`. Marketing compared reviewed source revisions with the integrated copy. | Code inspection, not deployed behavior. |
| Local component evidence | Committed desktop/mobile entry and assessment screenshots were inspected. They explicitly label component/mock/no-auth behavior and fictional identities. | No live authentication, persistence, inference or rating-quality acceptance. |
| Prior staging evidence | PM last reported staging `947e98b978eeb7de7ffaa7a450343525efce1482` with health and basic synthetic role/privacy/PAT/MCP checks. | Earlier revision; does not verify the newly integrated UI or assessments. |
| Integrated staging functional checks | PM confirmed run `40110466615` at `144367fab48be597f00b64a50dd4fff748522f9d`, `https://staging.tembotechventures.com`: synthetic browser actions/API readback on desktop/mobile and database/browser cleanup passed. Marketing inspected the sanitized manifest and matching verifier assertions. | Architect reconciled the original artifact and individually inspected all eight stored screenshots; fictional content renders. Marketing independently viewed both known-profile images. Matching scout/direct-link images show the same selected detail state, not distinct intermediate-step proof. Live model calls not tested. |

Only promote individual claims after their matching goal evidence arrives. A
healthy endpoint or successful deployment does not establish those outcomes.

| Capability | Evidence | Permitted wording and limits |
| --- | --- | --- |
| Open membership | `web/src/lib/community/service.ts`: own profile access requires an authenticated actor, not a student role; `web/src/middleware.ts`: dashboard sign-in guard | “For TTV students and builders beyond our cohorts.” GitHub sign-in is required. Do not require cohort application in the community CTA. |
| Profile and contribution creation | `service.ts`: `updateOwnProfile`, `createJourney`; `web/src/components/community/community-client.ts`: `saveProfile`, `saveContribution` | “Build your journey”; “Add a contribution”; “Add a supporting link.” Links are optional and member supplied. Do not call every entry evidence-backed or externally verified. |
| Contribution visibility | `service.ts`: `listJourney`, `listMentorship`; `community-client.ts`: `saveContribution` sends `visibility: "institution"` | Explain institutional visibility before saving. Mentors/admins can review shared contributions. Backend private drafts exist, but this UI does not expose a private-save option. Do not advertise it. |
| Institutional discovery | `service.ts`: `requireInstitution`, `searchProfiles`, `getProfile`; `web/src/components/community/CommunityApp.tsx`: workspace gating | “Approved institutions can explore community profiles.” Approval adds permissions; it is not a different membership category. Mentor/admin exclusion from search remains. Do not equate this with the public talent directory or public indexing. |
| Approval | `service.ts`: admin-only `setAccess`; `CommunityApp.tsx`: approval-needed state | “Institutional access requires administrator approval after sign-in.” No self-service request form found in this slice. No “Request access” CTA implying a submitted request, approval timer or email response. |
| Mentor confirmations | `service.ts`: `confirmJourney`, revision and ownership checks; `web/src/components/discovery/ClaimConfirmations.tsx` | “Mentors can add a confirmation describing what they checked.” Not certification of the person or all their work. No invitation, booking or guaranteed review claim; no invitation workflow found. |
| Criterion-specific 1–5 evidence support | Integrated `web/src/lib/community/assessment-ai.ts`, `assessment-provider.ts`; `web/src/components/community/EvidenceAssessment.tsx`; contract `docs/community-evidence-assessments.md` | Source implemented. “Ratings describe how strongly the available evidence supports each criterion.” Insufficient, uncertain and contradictory evidence have null ratings and show “Not scored.” Provider or invalid-output failures are service issues, never low scores. Live inference and rating quality remain unverified. Never describe ability, personal trust or a hiring recommendation. |
| Empty evidence | `assessment-ai.ts`; `EvidenceAssessment.tsx` model-null label | Empty published evidence produces an evidence-availability result without a model call. UI says “No AI assessment was run.” Do not label this a successful AI assessment. The older literal coverage helper remains for compatibility; public endpoints use the model assessment path. |
| Evidence questions | `web/src/lib/community/chat.ts`, `community-client.ts`: `askProfile` | Code requires configured unified AI Gateway, checks source IDs/versions and handles ungrounded output. No claim of working live AI without exact deployed model/configuration and successful authenticated evidence. Citation validation does not independently verify the truth of prose. |
| External evidence links | `web/src/lib/community/model.ts`: `safeUrl`; `chat.ts`: explicit instruction not to claim external links were read | “Supporting link” or “Member-attached source.” Do not say the AI crawls, reads or independently validates linked repositories/artifacts. |
| External tools/MCP | `web/src/lib/community/mcp.ts`, `web/src/pages/api/mcp.ts` | Code present; require role-specific live evidence before demo claims. No automatic Drive import, conversation sync or OpenAI integration claim. |
| Interactive preview | `web/src/components/discovery/DiscoveryShell.tsx`; `/dev/community-ui` | “Fictional profiles and sample responses. Changes stay in this page.” Never present sample answers as live model results or browser-local edits as persisted records. |

Runtime wording for technical demo notes, pending live evidence: “The community
chat is implemented through Cloudflare AI Gateway with a community-specific model adapter.”
The gateway module's model identifier is not proof of a current successful
provider invocation. Community assessment/chat source pins Gemma through the unified Gateway; this
is not evidence of a successful live invocation. Do not claim OpenAI API runtime,
Decisions integration or a future provider swap is already implemented and verified.
Codex use in development and product inference are separate claims.

## Route and placement inventory

The public `/community` explanatory page, homepage section and contextual links
are implemented in this audited source. The copy below remains a specification;
Designer wording variants were reviewed and accepted. The page explains the
product; it is not a public member directory. Keep the
existing cohort/application journey; add clear community entry points alongside it.

| Surface | Placement and exact copy | Destination / behavior |
| --- | --- | --- |
| Public navigation, desktop and mobile | “Community” | `/community`. Public explanation before sign-in. |
| Homepage community section | Eyebrow “TTV community”; heading “People, with the work to tell their story.”; noncohort welcome and GitHub sign-in helper | Implemented section `id="community"`. Include member and institutional explanations, not a hidden dashboard link alone. |
| `/community` explanation | Heading “People, with the work to tell their story.”; source implements “Show the work”, “Add context” and “Start a conversation” explainer blocks. | Public explanation only; no member list or private profile indexing. |
| `/community` member CTA | “Join the community” | `/auth/login?next=%2Fdashboard%2Fcommunity`, or `/dashboard/community` when signed in. Helper: “Sign in with GitHub. You do not need to be in a TTV cohort.” |
| `/community` institutional CTA | “Continue to institutional access” | `/auth/login?next=%2Fdashboard%2Fdiscover`, or `/dashboard/discover` when signed in. Adjacent helper: “Institutional access requires administrator approval after sign-in.” |
| Homepage explanatory CTA | “How the community works” | `/community`. The internal homepage section may retain `id="community"`. |
| Homepage primary community CTA | “Join the community” (anonymous) / “Open my community journey” (signed in) | `/dashboard/community`; existing middleware returns anonymous visitors through GitHub login with the intended route. Explicit login equivalent: `/auth/login?next=%2Fdashboard%2Fcommunity`. |
| Institutional entry from homepage | “How the community works” leads to the public explanation and its institutional block. | `/community`, then “Continue to institutional access”; approval guidance is adjacent to that CTA. |
| Public footer | “Community” | `/community`, same explanation and destination as navigation. |
| `/hire` | “Want to explore documented work across the wider community?” CTA “Learn about institutional access” | `/community#institutions` with approval helper. Do not promise qualified candidates, matches or contact delivery. |
| `/talent` | “Not part of a cohort?” CTA “Build your community profile”; “The community also welcomes builders beyond TTV cohorts.” | `/community`. Explain that community profiles and the public builders showcase are different surfaces; do not claim joining publishes a showcase profile. |
| `/dashboard`, including noncohort state | “Your work has a story.” CTA “Open my profile and journey”; secondary “About the community” | `/dashboard/community`; visible without an accepted/completed cohort. Keep the existing next-step card. |
| Dashboard navigation | “Community”; use “My journey” within the community workspace | `/dashboard/community`; role-aware “Discover people” and “Mentor review” only where access allows. Do not show institution tools as available to everyone. |
| Existing profile/editing context | “Your community journey brings together the contributions behind your profile.” CTA “Open my journey” | `/dashboard/community`; distinguish public showcase eligibility. Designer to confirm actual existing profile route before placing. |
| `/dashboard/community`, above contributions | “Record what you contributed, add a supporting link, and give others the context to understand your work.” | “Add a contribution” opens the working form. Avoid “Get verified” and “Invite a mentor.” |
| Contribution form, immediately before save | “This contribution will be shared with approved institutions and available for mentor review. Add only information you intend to share.” | Save label “Share contribution” if Designer aligns it with actual publication behavior; otherwise retain “Save contribution” with this visible helper. |
| Profile editor, before save | “Approved institutions can find your community profile, including your skills and opportunity goals.” | Explicit visibility explanation; no opt-in or per-institution grant implied. |
| `/dashboard/discover`, approved state | “Understand the work behind a profile.” Helper “Explore contributions and mentor confirmations in the context of your criteria.” | Keep functional search/filter/profile tools. Human judgment remains necessary. |
| `/dashboard/discover`, unapproved state | “Institutional access needs approval.” Helper “An administrator must approve this additional access after sign-in. You can build your own community journey now.” CTA “Go to your journey” | `/dashboard/community`. Avoid a fake request/success flow. |
| `/dashboard/mentorship` | “Recognise the work. Name what you saw.” Helper “Review the contribution and its sources, then describe what you checked and how.” | Existing confirmation form; avoid person-wide verified labels. |
| Missing evidence or unavailable AI | “There is not enough documented evidence to assess this criterion.” / “An evidence-grounded answer could not be produced. Review the contributions directly or narrow your question.” | Keep direct source inspection available. Do not substitute a fabricated answer or low ability score. |

Short landing explainer, suitable for three existing UI blocks:

1. **Record your contribution.** Describe what you made, what you did and what you learned. Add a supporting link when you have one.
2. **Add context through mentors.** Mentor confirmations describe specific work they checked and how they checked it.
3. **Help institutions understand your work.** Approved institutions can explore your profile and shared contributions against their criteria.

Do not describe step 2 as guaranteed or member-triggered review. There is no
upvote count or popularity contest. Keep hiring as the illustrative opportunity,
without inventing employer-specific account types or guaranteeing an outcome.

## Acceptance and iterative review

### Proposed concise-copy pass

PM-relayed owner direction: clear user-facing language, fewer competing elements,
no repeated explanatory blocks or decorative labels. Preserve the layout and TTV
palette. These are proposed changes after the current staging capture, not claims
about the audited `144367f` implementation. Designer owns runtime edits.

| Priority / placement | Current wording or repetition | Proposed wording / treatment |
| --- | --- | --- |
| 1 · contribution save | Workspace sharing block plus full pre-save explanation | Keep one pre-save notice: “Shared with approved institutions and available for mentor review.” Keep the action explicit; do not imply private save. |
| 1 · profile save | “Saving updates the community profile that approved institutions can discover. Only include information you want to share with them.” | “Approved institutions can discover this profile.” Keep beside save; do not repeat the same block above the editor. |
| 1 · assessment | Long introductory explanation and repeated result disclaimer | Intro: “Choose criteria to assess the documented evidence.” Result note once: “Rates the evidence, not ability. Linked artifacts are not read.” Keep exact source scope and scale in expandable detail. |
| 1 · assessment states | AI label, evidence-support label, rubric/profile labels and model text compete | Preserve “Evidence support”, source/revision access, AI-generated vs no-AI distinction, “Not scored” states and service failures. Remove decorative eyebrows before removing essential distinctions. |
| 2 · public intro | Multiple membership explanations | “A community for TTV students and builders beyond our cohorts. Show your contributions, supporting work and mentor notes.” Use one clear member CTA; GitHub helper only for anonymous visitors. |
| 2 · institutional entry | Approval described before and after CTA | “Explore the work behind a profile.” One adjacent helper: “Administrator approval required.” Keep the honest approval screen and journey fallback. |
| 3 · repeated labels | Eyebrow + heading + legend repeat the same purpose | Keep the useful heading and accessible form labels; remove duplicate decorative text. Maintain source links and necessary permission guidance at the relevant action. |

Source-scope detail to preserve: assessments use profile text and skills,
published contribution text and current review notes; linked artifacts are not
fetched. Concision must not turn an evidence-support rating into an ability
rating or make a service failure look like missing evidence. Review actual
desktop/mobile changes before accepting this proposed pass.

- Designer reviews placement and implements runtime copy with meaningful automated tests; Marketing rechecks the actual diff against this matrix.
- Desktop and mobile visitors can find the public explanation from navigation and footer, understand noncohort membership, and follow the member CTA through sign-in to the intended workspace.
- A signed-in noncohort member can reach the journey without cohort application; privacy text appears before profile/contribution save. A reload demonstrates persistence before claiming it works.
- An unapproved account sees accurate approval guidance; an approved synthetic institution searches and inspects shared evidence. Private drafts and operational data stay out of that view.
- A synthetic mentor records a scoped confirmation; the member and institution can inspect its wording, method and revision. No automatic person-wide verified badge.
- Model/ratings claims require the exact integrated implementation and authenticated live successful and failure-path evidence. Re-audit after later model changes; source integration alone does not establish live quality.
- Use clearly labelled fictional Kenyan demo identities, for example Amina Wanjiku and Brian Otieno; never real student records. Do not infer abilities/background from names or nationality.
- Capture desktop/mobile screenshots, final URLs, deployed full SHA, clicked actions and observed results through the PM's serialized #171 staging slot. Sample UI captures alone do not establish live functionality.

No environment or manual deployment was created by Marketing. Documentation PR
#184 had an automatic isolated preview; its passing checks did not include the
later UI integration and are not evidence for those features. PM/Architect own
preview retention and cleanup. This refresh adds no live verification. Production
deployment, outreach and organizer submission remain outside scope.

### Integrated staging evidence and remaining gaps

PM-confirmed functional verification at the exact deployed revision:

- Deployment: `144367fab48be597f00b64a50dd4fff748522f9d`, staging,
  `https://staging.tembotechventures.com`; deploy run `40110097027`.
- Synthetic verification: run `40110466615`, sanitized artifact `12566246811`;
  manifest records desktop/mobile, browser-actions-and-api-readback,
  database-and-browser-passed cleanup and modelCalls=not-tested.
- Profile/contribution save, API readback and reload; mentor confirmation with
  method/role/revision; institution skill search, authorized evidence retrieval,
  known-person lookup and direct-link assertions: functional checks passed.
- Scout/known-profile screenshots were reconciled against the original ZIP.
  Architect withdrew the earlier blank-image finding after checking stored bytes
  and viewing images individually; Marketing independently viewed the desktop
  and mobile known-profile images. Identical scout/direct-link pairs show the
  same selected detail state. Functional assertions establish intermediate steps;
  the duplicate images are not separate visual proof of each step. No runtime
  capture defect or rerun is established by the withdrawn report.
- Public navigation → explanation → GitHub return route: code/isolated preview
  evidence exists; exact shared-staging goal acceptance not separately established
  by this authenticated fixture manifest.
- Live assessment/chat inference, model-quality findings, latency and cost:
  untested by this run. Empty-evidence/no-AI and service-failure labels are source
  implemented; do not imply live generated results.
- PAT checks passed in the reported verification; do not promote that to external
  MCP interoperability or a complete external-agent user journey without matching
  goal evidence.

## Short demo script and claims ledger

Draft for PM review, not an organizer submission. Center the member's work;
agent coordination is supporting context. All names, projects and statements in
the demonstration are explicitly fictional. Do not imply a real job outcome.

**Opening:** “How does someone without an established network help a hiring
manager understand their work? Here is a fictional example: Amina Wanjiku.”

**Member:** “Amina records her contribution to a community library project:
keyboard navigation, what she changed and a supporting link.” Show the saved
entry and reload it. Explain sharing at the save action, not in another speech.

**Mentor:** “Grace Njeri adds what she personally checked and how. Her note
applies to this contribution, not to every claim about Amina.” Show the note,
method and contribution revision.

**Institution:** “An approved institutional user searches for React and
accessibility work, opens Amina's profile and examines the contribution and
mentor note. The question is: ‘Why should I interview this person?’ The work
and its context give the hiring manager a starting point for that conversation.”

**Assessment, only after a verified live model result:** “These criteria rate
the support in documented evidence, not Amina's ability. Insufficient evidence
is unscored, and the hiring decision stays with the person reviewing it.” If
live inference is unavailable, omit the generated-result segment or explicitly
label a separate mocked illustration. Never present sample output as live.

**Close:** “TTV already had cohort learning and public builder profiles. This
hackathon adds an open community journey, contribution-scoped mentor notes and
institutional discovery with evidence exploration.” Verify the final demo
revision and actual Codex contribution before presentation. Do not claim a
specific organizer rubric, winning outcome, OpenAI inference or provider switch.

| Script claim | Evidence / release condition |
| --- | --- |
| Save and reload profile/contribution | Staging run `40110466615`, artifact `12566246811`: Marketing privately inspected the sanitized manifest, exact deployed SHA `144367fab48be597f00b64a50dd4fff748522f9d`, synthetic=true, browser-actions-and-api-readback, desktop/mobile passed, database-and-browser cleanup passed. Corresponding verifier assertions check save, API readback and reload. PM confirmed the functional checks; stored-image reconciliation is recorded below, while live-model acceptance remains separate. |
| Mentor note and institution sees contribution/provenance | Same run and inspected verifier assertions check mentor method/statement/role/revision, institution skill search and authorized profile evidence on both viewports. No claim of independent artifact verification. |
| Known-person direct link | Functional assertions passed. Original stored images render fictional content; the earlier blank-image report was withdrawn after ZIP/byte and individual-image inspection. Scout and direct-link images legitimately show the same selected profile; do not claim separate visual proof of every intermediate step. |
| Institution-defined assessment criteria and 1–5 results | Implemented source only for this evidence package. Manifest explicitly says modelCalls=not-tested. No verified live inference, rating quality, latency or cost claim. The tested skill filters are not an assessment rubric. |
| “Why should I interview this person?” | Narrative question, not a demonstrated model answer. Human judgment remains required. |
| Codex contribution | Final presentation must identify actual inspected development work/commits; no quantified productivity claim or runtime inference claim follows from using Codex to build. |

No raw logs, traces or screenshots are republished by this draft. The manifest
was downloaded privately and checked without printing credentials or private
identifiers. Screenshots require their publisher's own visual/privacy inspection.

## Items to resolve through PM

1. **Approval next step:** approval exists but no institutional request UI was found. Current copy explains the requirement and links to the journey. Track a streamlined institutional request process as an unresolved enhancement. PM should determine a real next step before adding any request/contact promise; this is not a prerequisite for truthful copy.
2. **Assessment release wording:** 1–5 semantics are implemented at the audited revision; public/demo availability and quality claims still require matching live evidence.
3. **Visibility wording:** profile discovery and institution-shared contributions are distinct from the public talent showcase. The current form publishes contributions directly; private draft UI is not advertised.

These do not block truthful landing/member copy or route placement work.
