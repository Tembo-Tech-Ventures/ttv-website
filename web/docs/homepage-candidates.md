# Homepage candidates (October 2026)

Three complete homepage designs, built side by side so the owner can pick one.
Each lives at its own preview route and shares the same content, data and
quality bar; they differ only in composition, interaction and motion.

| Candidate | Route | Direction |
|-----------|-------|-----------|
| A | `/preview/home/a` | Kinetic editorial: type is the image |
| B | `/preview/home/b` | Layers: the page as a stack of sheets |
| C | `/preview/home/c` | Constellation: the community as a living network |

When one is chosen it replaces `src/pages/index.astro`, the other two and their
components are deleted, and the public nav anchors are pointed at its sections.

## What the page must say, in this order

The section ids are a contract (`SECTION_ORDER` in `src/lib/homepage/content.ts`,
enforced by `e2e/homepage-candidates.spec.ts`).

1. **`#cohorts` — the cohort programme (primary).** TTV runs small cohorts where
   early builders learn by shipping real software alongside working engineers,
   and stay in touch afterwards. Facts: about 25 builders so far, Cohort 04
   running now, one partner school (Embu College). Primary action: apply.
2. **`#builders` — previous builders.** Published cohort graduates from the
   database (`loadHomepageBuildersSafely`): name, cohort, headline, skills, top
   project. Must look intentional with 0, 1, 4 or 8 profiles, and with or
   without avatar images (most have none: initials are the default).
3. **`#community` — join even without a cohort.** Three ways in: builder, mentor,
   institutional partner (access to talent). Mentor and partner access is
   approved by the team; say so.
4. **`#hire` — hire our builders.** Hire previous students or propose a project
   (`/hire`).
5. **`#principles` — what we hold ourselves to.** The five values from the
   earlier homepage, word plus commitment, with the outlined display type the
   owner liked. Every word fully visible at every width — the earlier version
   cropped them.

All copy comes from `src/lib/homepage/content.ts`. Do not invent claims,
numbers, testimonials, placements or features.

## Owner direction

- Minimalist in **vibe and style**, not in content. An earlier pass stripped the
  page bare; that was wrong. Each section has real substance.
- **No eyebrows**: no small uppercase labels above big titles, no `§ 01`
  numbering, no decorative kickers.
- Keep the brand: dark teal `#013D39`, peach `#F28D68`, lighter teal `#2C6964`,
  warm ink `#FFF8F2`, the grain; Mattone Black for h1/h2, Maven Pro for
  everything else. Balanced type scale: no giant word beside a tiny one.
- Awwwards-level craft: authored motion, layering, elements sliding in and out,
  micro-delights on hover and focus, interactions that reward curiosity. Motion
  must be visible, not so subtle it is missed, and never block reading.
- Calm grids. Nothing misaligned, nothing busy.
- Community voice, not rescue voice (no "uplift", "empower the underserved").

## Non-negotiables

- Every word readable at some point while scrolling, at 390, 820, 1440 and
  1920 px: `node scripts/homepage-lab/audit.mjs` and the Playwright spec check
  for text that is cropped, off-screen, covered or never faded in.
- `prefers-reduced-motion: reduce` shows the finished composition with no
  scroll-jacking and no motion beyond opacity.
- Everything works by keyboard with visible focus; hover is never the only way
  to reach content (touch has no hover).
- No horizontal page scroll. No console errors. One `h1`.
- No new dependencies. GSAP 3.15 is installed with ScrollTrigger, SplitText,
  Flip, Draggable, Observer, InertiaPlugin, DrawSVG and ScrollSmoother.
- Phones on patchy data are the main audience: no video or large images, and
  nothing heavy before first paint.

## Personas used in critique

These are composites for critique, not research subjects; names are fictional.

1. **Prospective student — Wanjiku, 21, Embu.** Self-taught JavaScript on a
   mid-range Android phone with metered data. Wants to know what a cohort is,
   whether she qualifies (no degree), what she would build, and how to apply.
2. **Mentor — David, senior engineer in Nairobi.** Busy, sceptical of
   programmes that use mentors as decoration. Wants to know what is asked of
   him, how much time, and whether the work is real.
3. **Institutional partner — Grace, talent lead at a Nairobi company or
   accelerator.** Wants evidence of real ability, not certificates, and a clear
   path to access talent.
4. **Client — Tomás, founder with a small project.** Wants to know if he can
   hire builders or propose work, and what happens next.

Plus an Awwwards juror's lens (design, usability, creativity, content).

## Working in the lab

```bash
cd web
npx wrangler d1 execute ttv-database --local --file scripts/homepage-lab/seed-builders.sql   # fictional builders
node scripts/homepage-lab/audit.mjs --path /preview/home/a --out ../.homepage-lab/a/check      # frames + readability
npx playwright test e2e/homepage-candidates.spec.ts --project=chromium --project=mobile-chromium
```

The audit writes viewport frames, motion frames taken 90 ms after each scroll,
and a contact sheet per viewport. Look at them: a passing audit is not a
beautiful page.
