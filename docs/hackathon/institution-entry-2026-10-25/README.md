# Institutional dashboard entry and directory clarity

Bounded PM assignment from live persona QA. Institutions (and existing authorized admins) now see Discover in dashboard and Ask AI navigation; dashboard home leads to discovery. The member journey, application and cohort links remain additive. Presentation uses the existing community service access result; no server permissions, eligibility, API contracts or workflow changes.

Directory cards no longer carry ordinals. Copy describes alphabetical results, the 50-result cap (not an invented total), and the separation of opportunity context/evidence ordering from skill retrieval. Singular contribution counts are corrected, including confirmed entries.

Validation: 25 focused unit tests after rebasing onto integration be8392a (including its citation-label regression), three Chromium cases at 390/1440 px, focused lint, TypeScript, Astro check (0 errors, 0 warnings, 59 hints). Screenshots are local component fixtures with fictional personas, not live authenticated staging proof. `navigation-*` shows the actual dashboard shell (mobile drawer open); `results-*` shows the existing fictional scouting demo. The browser fixture explicitly includes production component Tailwind sources.

Commands from web:
- `npx vitest run src/lib/dashboard-presentation.test.ts src/components/shells/DashboardShell.test.tsx src/components/discovery/ScoutWorkspace.test.tsx`
- `npx playwright test --config e2e/institution-entry.config.ts`
- `npm run typecheck`
- `npm run typecheck:astro`

Developer owns integration and serialized staging verification. No independent deployment or live persona mutation performed by this change. EvidenceOrdering citation changes are outside this patch.

## Separate QA navigation and history follow-up

Discover was already reachable via Dashboard → Community → shell navigation. The direct entry fixes discoverability and home guidance, not a wholly inaccessible route. Prior QA sessions were revoked; human `/demo` behavior was not reproduced and is not claimed defective.

Restricted QA sessions now derive visible navigation and the primary next-step CTA from the existing QA path allowlist. Blocked links/feedback are hidden; the existing QA sign-out remains. Ordinary member and human-demo permissions are unchanged. Mobile community exposes the Dashboard backlink. Fictional names retain their marker while greetings/CTAs identify the person.

Submitted discovery criteria and selected profile IDs support Back/Forward/refresh. Skills/query/profile IDs use query parameters; opportunity text is stored only in this tab's history state, not the URL. Loaded records, evidence, model answers and credentials are never saved. Refresh uses existing authorized read APIs again; errors leave the filters editable. Direct profile links remain authorization-gated. No pagination or API changes.

Follow-up validation: 35 focused unit cases across the five affected suites (including the added CTA test rerun), six local Chromium cases including mobile navigation, restricted QA links, Back/Forward/refresh and failed-restoration recovery; focused lint and TypeScript pass; Astro check 0 errors, 0 warnings, 59 hints. Updated result screenshots are local fictional component evidence only. No live authenticated QA retest or deployment was performed.

PR220 preview run40193866868: identity/public routes passed, browser201passed/170skipped/6notrun and one container-health failure; teardown skipped. This is not a green live preview. Workflow owner Developer received the blocker; artifact12599102753.
