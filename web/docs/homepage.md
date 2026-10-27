# The homepage

`src/pages/index.astro` renders `src/components/homepage/Homepage.astro`: a stack
of sheets that tip back as the next slides over them, one network language
(builders as peach dots, mentors as light-teal rings, partners as ink diamonds),
and a skills map in the spirit of École 42's progression graph. Chosen by the
owner in October 2026 from four designs built side by side (see History).

## What the page says, in this order

The section ids are a contract (`SECTION_ORDER` in `src/lib/homepage/content.ts`,
enforced by `e2e/homepage.spec.ts`), and the public nav links to them.

1. **`#cohorts` — the cohort programme (primary).** TTV is an African tech
   community, starting in East Africa and Nigeria, that runs small cohorts
   where early builders learn by shipping real software alongside working
   engineers. Facts: about 25 builders so far, Cohort 04 running now, one
   partner school (Embu College). Primary action: apply; "No degree required."
   sits beside it. The section is two sheets: the hero with its cohort deck,
   then the skills map sliding over it.
2. **`#builders` — previous builders.** Published cohort graduates from the
   database (`loadHomepageBuildersSafely`), as a card file whose covered cards
   stay readable as an index of names. Must look intentional with 0, 1, 4 or 8
   profiles, with or without avatars.
3. **`#community` — join even without a cohort.** Builder, mentor,
   institutional partner. Mentor and partner access is approved by the team;
   the page says so.
4. **`#hire` — hire our builders** or propose a project (`/hire`).
5. **`#principles` — what we hold ourselves to.** The five values in outlined
   Mattone, one shared size, never cropped.

All copy comes from `src/lib/homepage/content.ts`. Do not invent claims,
numbers, testimonials, placements or features.

### The skills map is an illustration

The map (`src/lib/homepage/skills-map.ts`, `SkillsMap.astro`) is drawn only
from skills on published profiles, and its caption says it is an illustration.
TTV does not track anyone's progress through a map. Nothing on the page may say
or imply that it does: no cohort number at the map's centre, no skill drawn as
"completed", the caption read before the picture. If a real skills map is built
later, this is the place to start.

## Owner direction

- Minimalist in **vibe and style**, not in content. Each section has substance.
- **No eyebrows**: no small uppercase labels above big titles, no `§ 01`
  numbering, no decorative kickers.
- The brand: dark teal `#013D39`, peach `#F28D68`, lighter teal `#2C6964`, warm
  ink `#FFF8F2`, the grain; Mattone Black for h1/h2, Maven Pro for everything
  else. Balanced type scale.
- Authored motion and layering that is visible but never blocks reading; calm,
  aligned grids; community voice, never rescue voice.

## Rules the tests enforce

`e2e/homepage.spec.ts`, against local dev servers and deployed previews alike:

- the sections in the order above, the five principles, one `h1`;
- every word fully readable at some point while scrolling, at phone and desktop
  sizes, with and without reduced motion (`e2e/text-integrity.ts` fails text
  that is cropped, off-screen, covered or never faded in);
- every link and button reachable by Tab from the top (reveal animations must
  never park focusable content at `visibility: hidden`);
- every section anchor lands with its heading visible and uncovered, jumping
  down from the top or back up from the bottom. Sticky sheets make the browser
  scroll to where a section is stuck rather than where it sits;
  `scripts/navigate.ts` routes anchors, hash changes and focus to the real
  position.

Also: `prefers-reduced-motion` shows the finished composition; hover is never
the only way to reach content; no horizontal scroll; no console errors; no new
dependencies; display-face tracking only through the `--tracking-*` tokens
(`src/styles/typography.test.ts`). Fully covered sheets drop to opacity 0 so
the browser stops painting them (never `visibility: hidden`, which would break
Shift+Tab).

## Working on it

```bash
cd web
npx wrangler d1 execute ttv-database --local --file scripts/homepage-lab/seed-builders.sql  # fictional builders
node scripts/homepage-lab/audit.mjs --path / --out ../.homepage-lab/check                    # frames + readability
npx playwright test e2e/homepage.spec.ts --project=chromium --project=mobile-chromium
node scripts/homepage-lab/record.mjs scripts/homepage-lab/tours/homepage.mjs ../.homepage-lab/videos/homepage.mp4
```

The audit writes viewport frames, motion frames taken 90 ms after each scroll,
and a contact sheet per viewport. Look at them: a passing audit is not a
beautiful page. The dev server needs `CLOUDFLARE_VITE_FORCE_LOCAL=true` and,
without Docker, a local `"dev": { "enable_containers": false }` in
`wrangler.jsonc`.

### Personas used in critique

Composites, not research subjects; names are fictional.

1. **Wanjiku, 21, Embu — prospective student** on a mid-range Android with
   metered data: what a cohort is, whether she qualifies, how to apply.
2. **David, senior engineer in Nairobi — mentor**: what is asked of him, how
   much time, whether the work is real.
3. **Grace, talent lead — institutional partner**: evidence of real ability and
   a clear path to talent.
4. **Tomás, founder — client**: can he hire builders or propose work, and what
   happens next.

Plus an Awwwards juror's lens (design, usability, creativity, content). The
page does not yet say how much time mentoring takes; every critique marked the
mentor persona down for it, and the owner has to supply it.

## History

In October 2026 four designs were built side by side, each by its own agent,
and each put through independent critique (a fresh critic per round, working
as the four personas and a juror from screenshots, motion frames and real
interaction), revised, and release-checked. Narrated walkthroughs and the
round-by-round critiques are in the SAM library under
`/reports/homepage-candidates-2026-10-27/`.

| Design | Idea | Release-check scores (Design / Usability / Creativity / Content) |
|--------|------|------------------------------------------------------------------|
| A, Kinetic editorial | Type as the image; a live outlined 04 handing off into the cohort strip | 8 / 8 / 8 / 8 |
| B, Layers | Sheets that tip back, a cohort deck, a builder card file | 8 / 8 / 8 / 9 |
| C, Constellation | The community as a living network; builders threaded by shared skills | 8 / 8 / 8 / 8 |
| D, Layers, mapped | B with C's network language and a skills map | 8 / 8 / 9 / 9 |

The owner liked B best, asked for D, and chose D. A, B and C were deleted when
D shipped; they remain in the branch history (`sam/im-still-happy-homepage-7wegmn`).
