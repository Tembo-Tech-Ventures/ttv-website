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
