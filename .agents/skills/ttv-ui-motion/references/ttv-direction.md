# TTV: the established design language

Read the rendered homepage and `web/docs/homepage.md` before making a new
aesthetic decision. This describes the shipped October 2026 direction, not a
permanent ban on future art direction the user explicitly requests.

## What the homepage work established

PR229 (`ffb7cb2`) records four candidates: kinetic editorial, layers,
constellation, and the selected hybrid "Layers, mapped." The user preferred the
tangible sheets of B and chose D with C's community/network language. Historic
narrated tours and independent critiques are in the SAM library at
`/reports/homepage-candidates-2026-10-27/`. Seek them if decisions are unclear;
release-check scores are historical judgments, not proof of new work's quality.

Useful source paths relative to repository root, under
`web/src/components/homepage/`:

- `Cohort.astro`, `scripts/deck.ts`: a real deck; selection changes which cohort
  and builders are presented. It parts with interaction; mobile stays calmer.
- `SkillsMap.astro`, `scripts/map.ts`: a path and walking group connect skills.
  Phones use a readable vertical path rather than shrinking the desktop diagram.
- `scripts/thread.ts`: the network language continues through the page.
- `Sheet.astro`, `sheet.css`, `scripts/stack.ts`: broad rounded sheets carry
  distinct material tones and spatial continuity as the reader scrolls.
- `Builders.astro`, `BuilderCard.astro`, `scripts/builders.ts`: profiles form a
  card file, with exposed names and meaningful selection.

The important inheritance is a tangible, connected community: people and work
finding a place in a larger composition. Copying a green rectangle and peach
button does not carry that relationship forward.

Keep the homepage's existing no-new-dependencies constraint unless the user
explicitly authorizes a change. Existing CSS, native browser animation, SVG,
and the installed GSAP are available; follow the repository's delivery rules.

## Visual voice

- Deep teal `#013D39`, peach `#F28D68`, raised green `#2C6964`, warm white
  `#FFF8F2`, restrained grain, hairline borders and soft grounded shadows.
- Mattone Black display type, Maven Pro body; punchy but balanced type scale.
- Upright readable surfaces, generous breathing room, coherent rounded corners.
- Peach dots = builders, teal rings = mentors, diamonds = institutions/partners.
  Decorative motion must not imply verification or a real user event.
- Minimal in vibe, substantial in content. No decorative eyebrows or section
  numbers. No invented outcomes, testimonials, or unsupported features.

## Lessons from community review

The user rejected rear decorative strips whose edges stopped at the foreground
curve. Use complete underlying surfaces with coherent size and corner geometry.
They also rejected rotated borders crossing avatars, text, or the caption.
Temporary spatial separation can be expressive; the final reading surface must
clearly own all its content.

The first full-card revision was rejected as beginner-quality: identical
fade/blur/scale entrances did not convincingly express depth, weight, or a
creative idea. Tests and recordings had been treated as evidence of aesthetic
success. Do not preserve that animation merely because its tests pass.

Do preserve visible page-sheet sliding; the user explicitly disliked its
removal. Keep disclosure expansion and navigation stable. A new card treatment
should fit the established page rather than replacing the page.

For the persona pages, examine each story before deciding whether it needs a
distinct gesture: a member's contribution, a mentor's scoped review, and an
institution's exploration of evidence. Shared materials and motion grammar can
support different emphasis without inventing new content.
