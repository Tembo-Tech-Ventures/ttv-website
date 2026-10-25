# Homepage values refinement

The actual staging homepage was inspected before finalizing the change. Its `/` route hydrates `FeaturesSection` at `#what-we-do`, beneath “A community, not a course.” The rendered section had three bento articles, no links, and no carousel controls. [Staging before](staging-before.png) records that mapping. The separate `#values` section was the five-row static commitment list, with explicit clipping in its word styles.

The new manual carousel uses the exact source values and descriptions from that list: COMMUNITY, PHILOSOPHY, EQUITY, CONTINUITY, HONESTY. Both sections import one shared data source. All original bento titles and body copy remain available in the native keyboard-accessible “How we build together” disclosure. The §02 section remains a static list of five commitments.

Words fit the available width using the actual loaded font's measured advance width and font-size changes only. Glyphs are never stretched or clipped. A conservative container-relative size remains available before hydration. Width-only resize observation avoids font-height feedback loops; late font loading also triggers fitting. The description bubble overlays the lower stage rule, below the lettering, and animates only when the user changes the slide. Reduced motion disables the animation. There is no autoplay.

Previous/Next buttons retain focus, support native Enter/Space, and accept Left/Right/Home/End. A polite atomic live region announces each chosen slide. The preserved static list keeps all commitments accessible without carousel interaction.

## Verification

- Three focused unit tests: exact values/copy, initial carousel semantics, preserved static list and program content.
- Six Chromium component checks: every value and description at 280, 390, 1440, and 3440 CSS pixels; no horizontal overflow or clipped words in either section; no bubble/word overlap; forward/backward wrapping; keyboard focus and Home/End; reduced motion; disclosure keyboard access; resizing without oscillation.
- Enlarged-text check uses a 720 CSS pixel viewport (the layout width of a 1440px display at 200% browser zoom), plus independently enlarged 200% root text. This is a layout/text-zoom simulation, not a claim of browser-chrome zoom automation.
- Focused ESLint/Oxlint and TypeScript checks pass. No full-suite churn for this bounded change.

Screenshots use actual components, production stylesheet and self-hosted Mattone font in an isolated Vite harness, with animation finished for capture. [280px](width-280.png), [390px](width-390.png), [desktop](width-1440.png), [ultrawide](width-3440.png), [enlarged text](enlarged-text.png). These are component evidence, not live deployment acceptance. No staging or production deployment was executed.

Reproduce from `web/`: `npx vitest run src/components/homepage/values.test.tsx` and `npx playwright test --config e2e/homepage-values.config.ts`.
