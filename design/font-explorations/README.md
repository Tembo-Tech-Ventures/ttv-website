# Heading font exploration

Climate Crisis is doing the right job emotionally — loud, chunky, activist-poster —
but its counters are nearly closed, so anything longer than a word gets hard to read.
This folder holds like-for-like screenshots of three replacement candidates that keep
the chunk and open the letterforms back up.

Nothing here changes the site. Adopting a font is a two-line edit to
`web/src/styles/global.css`.

## The three candidates

| | Font | Weight | Source | License |
|---|---|---|---|---|
| 1 | **Panchang** Extrabold | 800 | [Fontshare](https://www.fontshare.com/fonts/panchang) (Indian Type Foundry) | [ITF Free Font License](https://www.fontshare.com/licenses/itf-ffl) — free for commercial use |
| 2 | **Mattone** Black | 900 | [Collletttivo](https://www.collletttivo.it/typefaces/mattone) ([GitHub](https://github.com/collletttivo/mattone)) | OFL 1.1 |
| 3 | **Bricolage Grotesque** ExtraBold | 800 | [Google Fonts](https://fonts.google.com/specimen/Bricolage+Grotesque) | OFL 1.1 |

Three different free-font sources on purpose — one commercial-friendly foundry release,
one open-source collective, one Google Fonts. They also sit at three different points on
the loud→legible axis, so the choice is really "how much do you want to dial it back".

**Panchang** is the closest sibling to Climate Crisis: same rounded geometric skeleton and
the same poster weight, but the bowls are actually open. Least change to the brand feel.
Note it runs wide — `TEMBO` fills the hero edge-to-edge at the current `18vw` clamp.

**Mattone** ("brick") is a fat humanist slab. It reads as hand-cut protest lettering, keeps
plenty of attitude, and is the most legible of the three at the small `text-2xl` h2 size that
`/hire` uses. Warmest fit against the teal/orange palette.

**Bricolage Grotesque** is the biggest step down in loudness and the biggest step up in
flexibility. It's a variable font with optical-size and width axes, so it can be tuned per
breakpoint, and unlike the other two it's comfortable all the way down to h3–h6 — which
would let the whole type system run on one display face instead of the current
Climate-Crisis-for-h1/h2, Maven-Pro-for-everything-else split.

## The screenshots

Four views, four versions of each (current first, then the three candidates).

Side-by-side sheets — current | Panchang on top, Mattone | Bricolage below:

- `compare-1-home-hero.png` — the `TEMBO` wordmark at display size
- `compare-2-home-sections.png` — "A community, not a course." mid-size sentence case
- `compare-3-hire.png` — `/hire` h1 plus the small `text-2xl` subheads
- `compare-4-talent.png` — `/talent` h1 plus the card monograms

Full-resolution individual shots are in `shots/`.

The three pages are the homepage, `/hire` and `/talent`. The homepage gets two views because
the hero and the section headings are very different tests — the hero is one word at 15rem
where almost anything reads, and the section headings are full sentences at mid size where
Climate Crisis actually falls over. `/hire` is the hardest case in the whole site: its value
points set the display face at `text-2xl`, small enough that "Cohort-trained" is genuinely
hard to parse today. `/talent` shows the face reversed at both ends of the scale — a big h1
and two-letter monograms on every card.

`/talent` is populated with eight fictional demo profiles seeded into the local D1 database
so the grid isn't empty. None of that data is real or committed.

### Appendix

`shots/appendix/` has the other fourteen faces that were rendered on the homepage section
heading before narrowing to three, including runners-up worth a look if none of the three
land: Zodiak Black and Dela Gothic One (both strong), ChunkFive from The League of Moveable
Type, and Messapia — which the research ranked first but turns out to be far lighter in
practice than its "Bold" name suggests.

## Adopting one

Replace the `@import` and the `--font-heading` value in `web/src/styles/global.css`.

**Panchang** — Fontshare's licence covers commercial use but not redistribution, so load it
from their CDN rather than vendoring the files into this public repo:

```css
@import url("https://api.fontshare.com/v2/css?f[]=panchang@800&display=swap");
--font-heading: "Panchang", sans-serif;
```

**Mattone** — OFL, so self-host it. Drop `Mattone-Black.woff2` and the OFL text into
`web/public/fonts/` and declare the face directly:

```css
@font-face {
  font-family: "Mattone";
  src: url("/fonts/Mattone-Black.woff2") format("woff2");
  font-weight: 900;
  font-display: swap;
}
--font-heading: "Mattone", sans-serif;
```

**Bricolage Grotesque** — drop-in swap for the existing Google Fonts import:

```css
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,800&display=swap");
--font-heading: "Bricolage Grotesque", sans-serif;
```

Whichever wins, the per-element `letter-spacing` values currently tuned for Climate Crisis
(`-0.04em` on the hero, `-0.03em` / `-0.02em` elsewhere) should be revisited — these
screenshots use `-0.03em` for Panchang and Bricolage and `-0.02em` for Mattone.

## Regenerating

```bash
cd web && npm run dev                       # one shell
node design/font-explorations/capture.mjs   # another
```

`capture.mjs` injects the candidate over the running dev server and asserts via
`document.fonts.check` that the face actually loaded, so a silent fallback to system sans
can't quietly invalidate a comparison. Editing the `VARIANTS` array is all it takes to try
more faces.
