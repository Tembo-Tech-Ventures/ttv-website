# Community messaging and discoverability

Marketing handoff, 2026-10-24. Audited integration revision:
`d60a3310d28aecfea34a6d51ef64fb9f0d06d2c1` on
`sam/use-sam-mcp-tools-m8a3jp`, integration PR #171, evidence issue #170.
This is a copy specification, not a declaration that the feature is live.
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

| Capability | Evidence | Permitted wording and limits |
| --- | --- | --- |
| Open membership | `web/src/lib/community/service.ts`: own profile access requires an authenticated actor, not a student role; `web/src/middleware.ts`: dashboard sign-in guard | “For TTV students and builders beyond our cohorts.” GitHub sign-in is required. Do not require cohort application in the community CTA. |
| Profile and contribution creation | `service.ts`: `updateOwnProfile`, `createJourney`; `web/src/components/community/community-client.ts`: `saveProfile`, `saveContribution` | “Build your journey”; “Add a contribution”; “Add a supporting link.” Links are optional and member supplied. Do not call every entry evidence-backed or externally verified. |
| Contribution visibility | `service.ts`: `listJourney`, `listMentorship`; `community-client.ts`: `saveContribution` sends `visibility: "institution"` | Explain institutional visibility before saving. Mentors/admins can review shared contributions. Backend private drafts exist, but this UI does not expose a private-save option. Do not advertise it. |
| Institutional discovery | `service.ts`: `requireInstitution`, `searchProfiles`, `getProfile`; `web/src/components/community/CommunityApp.tsx`: workspace gating | “Approved institutions can explore community profiles.” Approval adds permissions; it is not a different membership category. Mentor/admin exclusion from search remains. Do not equate this with the public talent directory or public indexing. |
| Approval | `service.ts`: admin-only `setAccess`; `CommunityApp.tsx`: approval-needed state | “Institutional access requires administrator approval after sign-in.” No self-service request form found in this slice. No “Request access” CTA implying a submitted request, approval timer or email response. |
| Mentor confirmations | `service.ts`: `confirmJourney`, revision and ownership checks; `web/src/components/discovery/ClaimConfirmations.tsx` | “Mentors can add a confirmation describing what they checked.” Not certification of the person or all their work. No invitation, booking or guaranteed review claim; no invitation workflow found. |
| Evidence assessment | `web/src/lib/community/assessment.ts`: `assessEvidence` | Current method is literal term matching with supported/contradictory/uncertain/insufficient states, not 1–5 scoring. Do not market numeric ratings as available at this base. |
| Proposed 1–5 evidence support | Owner decision; model work in PR #182 remains proposed/unverified per PM | Only after integration and live validation: “Ratings describe how strongly the available evidence supports each criterion. Insufficient evidence is shown separately.” Never describe ability, personal trust or a hiring recommendation. |
| Evidence questions | `web/src/lib/community/chat.ts`, `community-client.ts`: `askProfile` | Code requires configured unified AI Gateway, checks source IDs/versions and handles ungrounded output. No claim of working live AI without exact deployed model/configuration and successful authenticated evidence. Citation validation does not independently verify the truth of prose. |
| External evidence links | `web/src/lib/community/model.ts`: `safeUrl`; `chat.ts`: explicit instruction not to claim external links were read | “Supporting link” or “Member-attached source.” Do not say the AI crawls, reads or independently validates linked repositories/artifacts. |
| External tools/MCP | `web/src/lib/community/mcp.ts`, `web/src/pages/api/mcp.ts` | Code present; require role-specific live evidence before demo claims. No automatic Drive import, conversation sync or OpenAI integration claim. |
| Interactive preview | `web/src/components/discovery/DiscoveryShell.tsx`; `/dev/community-ui` | “Fictional profiles and sample responses. Changes stay in this page.” Never present sample answers as live model results or browser-local edits as persisted records. |

Runtime wording for technical demo notes, pending live evidence: “The community
chat is implemented through Cloudflare AI Gateway with a configurable model.”
The gateway module's model identifier is not proof of a current successful
provider invocation. Do not claim OpenAI API runtime, Decisions integration,
Gemma invocation or a future provider swap is already implemented and verified.
Codex use in development and product inference are separate claims.

## Route and placement inventory

The public `/community` explanatory page and homepage section below are approved
Designer work, absent at this audited base. Create and test destinations before
linking them. The page explains the product; it is not a public member directory. Keep the
existing cohort/application journey; add clear community entry points alongside it.

| Surface | Placement and exact copy | Destination / behavior |
| --- | --- | --- |
| Public navigation, desktop and mobile | “Community” | `/community`, once the page exists. Public explanation before sign-in. |
| Homepage community section | Eyebrow “TTV community”; heading “Let your work tell your story.”; positioning paragraph above | Proposed section `id="community"`. Include member and institutional explanations, not a hidden dashboard link alone. |
| `/community` explanation | Heading “Your work. Your story.”; use the positioning paragraph and three-block explainer below. | Public explanation only; no member list or private profile indexing. |
| `/community` member CTA | “Join the community” | `/auth/login?next=%2Fdashboard%2Fcommunity`, or `/dashboard/community` when signed in. Helper: “Sign in with GitHub. You do not need to be in a TTV cohort.” |
| `/community` institutional CTA | “Continue to institutional access” | `/auth/login?next=%2Fdashboard%2Fdiscover`, or `/dashboard/discover` when signed in. Adjacent helper: “Institutional access requires administrator approval after sign-in.” |
| Homepage explanatory CTA | “Explore the community” | `/community`. The internal homepage section may retain `id="community"`. |
| Homepage primary community CTA | “Build your journey” | `/dashboard/community`; existing middleware returns anonymous visitors through GitHub login with the intended route. Explicit login equivalent: `/auth/login?next=%2Fdashboard%2Fcommunity`. |
| Homepage institutional CTA | “Explore community profiles” | `/dashboard/discover`; adjacent helper: “Institutional access requires administrator approval after sign-in.” Unauthorized users see the approval state, not search results. |
| Public footer | “Community” | `/community`, same explanation and destination as navigation. |
| `/hire` | “Looking beyond a CV? Explore community profiles and the work behind them.” CTA “Explore community profiles” | `/dashboard/discover` with approval helper. Do not promise qualified candidates, matches or contact delivery. |
| `/talent` | “Building your own story? Students and builders beyond our cohorts can create a community journey.” CTA “Build your journey” | `/dashboard/community`. Explain that community profiles and the public builders showcase are different surfaces; do not claim joining publishes a showcase profile. |
| `/dashboard`, including noncohort state | “Your work belongs in the story. Add projects, contributions and supporting links to your community journey.” CTA “Build your journey” | `/dashboard/community`; visible without an accepted/completed cohort. Keep the existing next-step card. |
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

- Designer reviews placement and implements runtime copy with meaningful automated tests; Marketing rechecks the actual diff against this matrix.
- Desktop and mobile visitors can find the public explanation from navigation and footer, understand noncohort membership, and follow the member CTA through sign-in to the intended workspace.
- A signed-in noncohort member can reach the journey without cohort application; privacy text appears before profile/contribution save. A reload demonstrates persistence before claiming it works.
- An unapproved account sees accurate approval guidance; an approved synthetic institution searches and inspects shared evidence. Private drafts and operational data stay out of that view.
- A synthetic mentor records a scoped confirmation; the member and institution can inspect its wording, method and revision. No automatic person-wide verified badge.
- Model/ratings claims require the exact integrated implementation and authenticated live successful and failure-path evidence. Re-audit after #182 or later model changes land.
- Use clearly labelled fictional Kenyan demo identities, for example Amina Wanjiku and Brian Otieno; never real student records. Do not infer abilities/background from names or nationality.
- Capture desktop/mobile screenshots, final URLs, deployed full SHA, clicked actions and observed results through the PM's serialized #171 staging slot. Sample UI captures alone do not establish live functionality.

No new environment was created for this documentation task. At assignment PM
reported staging `947e98b` as basic-auth-only evidence; this document adds no live
verification. Production deployment, outreach and organizer submission remain
outside scope.

## Items to resolve through PM

1. **Approval next step:** approval exists but no institutional request UI was found. Current copy explains the requirement and links to the journey. Track a streamlined institutional request process as an unresolved enhancement. PM should determine a real next step before adding any request/contact promise; this is not a prerequisite for truthful copy.
2. **Assessment release wording:** current base is literal coverage; owner-approved 1–5 semantics are a future gated claim until implementation and live evidence arrive.
3. **Visibility wording:** profile discovery and institution-shared contributions are distinct from the public talent showcase. The current form publishes contributions directly; private draft UI is not advertised.

These do not block truthful landing/member copy or route placement work.
