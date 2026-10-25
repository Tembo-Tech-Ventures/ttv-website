# Homepage values refinement

The actual staging homepage was inspected before finalizing the change. Its `/` route hydrates `FeaturesSection` at `#what-we-do`, beneath “A community, not a course.” The rendered section had three bento articles, no links, and no carousel controls. [Staging before](staging-before.png) records that mapping. The separate `#values` section was the five-row static commitment list, with explicit clipping in its word styles.

The new manual carousel uses the exact source values and descriptions from that list: COMMUNITY, PHILOSOPHY, EQUITY, CONTINUITY, HONESTY. Both sections import one shared data source. All original bento titles and body copy remain available in the native keyboard-accessible “How we build together” disclosure. The §02 section remains a static list of five commitments.

Words fit the available width using the actual loaded font's measured advance width and font-size changes only. Glyphs are never stretched or clipped. A conservative container-relative size remains available before hydration. Width-only resize observation avoids font-height feedback loops; late font loading also triggers fitting. The description bubble overlays the lower stage rule, below the lettering, and animates only when the user changes the slide. Reduced motion disables the animation. There is no autoplay.

Previous/Next buttons retain focus, support native Enter/Space, and accept Left/Right/Home/End. A polite atomic live region announces each chosen slide. The preserved static list keeps all commitments accessible without carousel interaction.

## Verification

- Three focused unit tests: exact values/copy, initial carousel semantics, preserved static list and program content.
- Eight Chromium component checks: every value and description at 280, 390, 1440, and 3440 CSS pixels; no horizontal overflow or clipped words in either section; no bubble/word overlap; forward/backward wrapping; keyboard focus and Home/End; reduced motion; disclosure keyboard access; resizing without oscillation; the exact live layout assertions rehearsed at desktop and mobile widths.
- Enlarged-text check uses a 720 CSS pixel viewport (the layout width of a 1440px display at 200% browser zoom), plus independently enlarged 200% root text. This is a layout/text-zoom simulation, not a claim of browser-chrome zoom automation.
- Focused ESLint/Oxlint and TypeScript checks pass. No full-suite churn for this bounded change.

Screenshots use actual components, production stylesheet and self-hosted Mattone font in an isolated Vite harness, with animation finished for capture. [280px](width-280.png), [390px](width-390.png), [desktop](width-1440.png), [ultrawide](width-3440.png), [enlarged text](enlarged-text.png). These are component evidence, not live deployment acceptance. No staging or production deployment was executed.

Reproduce from `web/`: `npx vitest run src/components/homepage/values.test.tsx` and `npx playwright test --config e2e/homepage-values.config.ts`.

## Preview test-discovery correction

Preview run 40175859373 deployed successfully but failed 14 browser cases: the component-only `.spec.ts` suite was discovered by the live runner (12 cases), and two existing static-values checks still used removed selectors. The component suite is now named `homepage-values.browser.ts` and selected only by its dedicated config. Default `playwright test --list` confirms it is absent, while both desktop/mobile live layout checks remain. The live layout test now verifies the five static commitments and all carousel slides using shared assertions rehearsed against the component fixture. No shared Playwright configuration or deployment workflow was weakened. A new preview result is still required for live acceptance.

## Dynamic slide rendering correction

Successor preview 40176913485 passed deployment/identity checks and 201 browser cases, but the two live values checks correctly caught a real rendering defect: after changing slides, the word span had no rendered box inside the form `fieldset`. This was reproduced on the isolated public preview. Replacing the slide container with a normal content group restored the word. The source now uses `div role="group"`, preserving slide labels and live announcements without form-field layout semantics.

As a diagnostic, intercepting only the FeaturesSection bundle in a local browser and substituting that tag made all five words visible at both 390px and 1440px against the preview page. This changed no deployed resource and is not live acceptance of the new source revision. Eight local browser checks and three unit tests pass; the fixture now exercises server-markup hydration. Shared live assertions explicitly require nonzero word dimensions as well as bounds and non-overlap. The retained `agent-pr-218` environment was not deleted: the failed workflow skipped teardown, and a fresh preview result/cleanup remains required.
