# TTV Codex Paris hackathon delivery contract

Status: owner authorized implementation on 2026-10-24. This is the working PM acceptance contract; feature completion requires evidence below.

## Hubs and deadline

- Tracking issue: https://github.com/Tembo-Tech-Ventures/ttv-website/issues/170
- Shared SAM channel: codex-paris-hackathon-2026-10
- Integration branch: sam/use-sam-mcp-tools-m8a3jp (PM's assigned output branch).
- Supporting PRs target that branch. The integration PR targets main but MUST NOT merge without separate production authorization.
- User-confirmed submission: 2026-10-25 23:00 UTC (midnight Paris, end Sunday).
- Presentation first pass: 2026-10-25 09:38:33 UTC, schedule d84dadee-3b2f-4062-af8f-4eb972ba3d88.
- No organizer submission authorized.

## Product commitments

1. Community members, including noncohort users, can build profiles and journey entries supporting their opportunity goals. Hiring is the first demonstration.
2. Approved mentors can examine artifacts and record what they checked, how, and their specific confirmation. An assistant response is not verification.
3. A single generic institutional role is approved by an admin after GitHub sign-in. No institution categories.
4. Approved institutions discover all students/open community profiles in the hackathon; no extra opt-in or per-institution grants.
5. Profile/journey contributions are institution-visible with clear copy. Private recordings, transcripts and internal/operational data are not automatically exposed or passed to models.
6. Talent directory retains cohort-completion eligibility and suitability moderation. Mentor/team public profiles are separate; institutional discovery does not imply public search indexing.
7. New institutional UX supports criteria-driven scouting and understanding a known person's claims/evidence, with integrated evidence-aware chat. Do not reuse cohort chat UI/retrieval scope.
8. Criteria-specific assessment supports evidence provenance, unknowns and source inspection. No universal personal trust score or upvotes.
9. Authenticated MCP exposes shared capabilities to institutions and members; a member cannot use institutional search. External agents may supply context without a TTV Drive integration.
10. Preserve existing cohort/student behavior and privacy boundaries.

## Initial implementation defaults (PM recommendations, revisable)

- Rate documented evidence against explicit criterion rubrics; insufficient evidence is distinct from a low rating. Do not infer protected traits or undocumented personal ability.
- Keep criteria/rubric and assessment version attached to results. Never display a mocked rating as a live model result.
- First mentor validation is an authenticated statement tied to an artifact; integrated live calling/scheduling is a stretch after the core journey works.
- External MCP returns structured evidence-linked results directly. Persist external context into a TTV conversation only through an explicit save/link action.
- Saved criteria and shared hiring-team reports are stretch scope.
- Model/provider selection must follow verified endpoint access and project policy; expose unavailable capabilities instead of fabricated output. The architect must resolve any policy conflict before runtime provider changes.

## Work ownership

- PM: coordination, this contract, integration PR/branch, acceptance evidence, deployment slot, prerequisites and owner reporting.
- Developer: schema/migrations, auth/role services, journey/validation backend, shared search/evidence/assessment/chat services and MCP. Own lockfile changes; coordinate dependencies.
- UI Designer: new frontend routes/components, member/mentor/institution UX and UI tests; align API contracts with Developer.
- Architect: architecture/security review, CI coverage, staging workflow/helpers and prerequisite audit; coordinate bindings before editing.
- Delegators may create bounded subtasks, but own descendant scope/review/integration/quality and announce roster/files before work. Avoid duplicate owners.

## Staging and integration rules

Every shared-staging revision must already be pushed and included in the MAIN hackathon integration PR branch. An isolated supporting PR is insufficient.

PM grants a single channel-announced deployment+verification window. Announce exact full integration SHA/PR before deploy. Verify live identity and user goals, report URL/logs/results, then release the slot. Do not overlap, overwrite or cancel peers. Do not mutate production.

Architect must ensure supporting PRs receive CI on the integration target; absence of checks is not a green gate.

## Evidence required for acceptance

- Noncohort member signs in, creates/edits a journey contribution, returns and sees it persisted.
- Mentor examines that contribution and records a scoped confirmation; member and institution can inspect its provenance.
- Admin approves institutional access; unapproved user cannot access institutional APIs/tools.
- Institution scouts using criteria, opens evidence, compares candidates and investigates a known profile with grounded chat.
- Missing evidence remains explicit; incorrect/unsupported citations, model failure and revoked access are tested.
- MCP institution performs a real search/investigation; member retrieves own journey but is denied institutional search and private artifacts.
- Desktop/mobile flows are actually clicked through on authenticated staging using clearly labelled fictional demo identities. Record screenshots and test/log evidence tied to exact deployed SHA.
- Full unit tests, lint, typecheck; targeted failure-path tests and architectural/security review. Passing tests or page rendering alone does not establish the outcome.
- No credentials/private student or organization documents in public issue, screenshots or commits.

## Reporting and resource ledger

PM posts concrete owner updates at least hourly in the existing PM chat, with #170/channel copies. Direct external push notification delivery is not established. SAM scheduled wakes can queue; escalate urgent blockers without waiting.

Finite durable hourly checkpoints are scheduled 2026-10-24 11:00 UTC through 2026-10-25 23:00 UTC inclusive, to the same PM session. First schedule: a6c7c47d-105b-4b48-9c7f-a0fb3716420e; last: 952182b6-daa5-401b-9b58-64728c9cd1f6.

Each checkpoint: PR/commit/diff, exact staging SHA/URL, clicked-through goal evidence/screenshots/logs, unfinished/blockers, next milestone/deadline risk, measured usage and quota freshness.

Keep token counts (including cached input), API dollars, SAM task budgets and provider subscription windows distinct. Do not infer subscription allowance from token counts. No resets or budget increases without owner authorization.

## Initial evidence / open prerequisites

- Baseline revision: 40d618162680d4a31e280d818f41cf149f7e8a0c.
- PM dependency install completed; npm audit reports 17 baseline vulnerabilities. Architect to classify; no automatic dependency churn.
- PM managed GH_TOKEN execution unavailable; GitHub connector independently works. Report tooling issues rather than bypass secret mediation.
- Staging persona credentials and runtime provider access are not yet verified. Architect owns early audit and minimum secure owner requests.
- No feature deployment or completed user journey claimed by this initial contract.
