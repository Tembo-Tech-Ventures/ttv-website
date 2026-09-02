# Printing the certificate

Feedback: a printed certificate should show the instructor's signature. Looking
at what the page actually prints turned up more than that, so this note records
both the defects in the shipped print CSS and the three treatments proposed to
replace it.

The prototypes live at `/dev/certificate-print/{a,b,c}` (dev-only, 404 in
production), with `/dev/certificate-print/current` rendering the shipped card
from the same fixture as a baseline.

## How these were checked

`node scripts/certificate-print-shots.mjs` (needs a dev server and
poppler-utils). It drives Chromium's real print path to PDF and rasterises the
result, rather than screenshotting `emulateMedia({ media: "print" })`.

That distinction matters. A print-media screenshot ignores `@page`, so it
cannot see orientation or margins, and it silently hides pagination — the
failure where a one-page credential spills a stray line onto a second sheet.
The script asserts a page count of exactly 1 and fails otherwise.

Each variant is rendered across two axes:

- **Letter and A4.** Fitting one says nothing about the other.
- **Background graphics on and off.** This checkbox is *off* by default in
  Chrome's print dialog. The no-backgrounds render is what most recipients
  actually get, and it is the render that exposes the baseline's problems.

## What the shipped page prints today

The current `@media print` block only strips padding, radius and shadow. Three
consequences, all visible in `baseline-as-shipped-letter-bg-*.png`:

1. **No signature.** The instructor appears only as a metadata row.
2. **With backgrounds off** — the default — the cream paper, the orange strip
   and the orange seal disc are all dropped. The seal degrades to a bare tick
   floating in white space with no disc behind it. Nothing in the CSS asks the
   browser to print those fills, so it doesn't.
3. **With backgrounds on**, the page prints a slab of dark teal across the
   bottom third of the sheet. `@media print` sets `background: #fff` on `.page`
   *and* `min-height: 0`, so `.page` shrinks to its content and the `body`
   background from `global.css` — `--color-dark` — prints below it. This is the
   worse of the two outcomes: ticking the box to get the brand colour is what
   causes it.

There is also no `@page` rule at all, so margins are whatever the browser
defaults to, and the card is stranded against the top edge.

## The three treatments

All three add the instructor signature, print the **full** verification URL
rather than the host (on paper the URL is not clickable, so a bare host cannot
be typed back in), and set `print-color-adjust: exact` on anything whose colour
is load-bearing so the sheet is identical with background graphics on or off.

| | A — one artefact | B — landscape diploma | C — ink-light portrait |
|---|---|---|---|
| Orientation | `size: auto` | `size: landscape` | `size: portrait` |
| Relationship to screen | identical | print-only layout | print-only layout |
| Signatories | one, inside the card | one, bottom-left | two, side by side |
| Toner | cream flood + orange | cream flood + orange | hairlines only |

**A** keeps the shipped card and fixes the printing, so the sheet is
recognisably the page whose link was shared. `size: auto` keeps whatever paper
the printer holds, and the card is centred on the page box rather than pinned
to the top.

**B** stops pretending the printed thing is a web card. Full-bleed cream,
rotated, signature carrying the bottom-left against the machine-checkable
credential on the right.

**C** is built to survive a bad printer: no filled areas at all, so it costs
almost no toner and photocopies cleanly. The single orange element is a 1pt
rule. It also shows the two-signatory case.

B and C set the sheet up as a CSS size container and measure everything in
`cqw`, so the on-screen preview is the printed sheet at a smaller scale rather
than a second layout that merely resembles it.

## What the schema cannot express yet

The prototypes stand in for data that does not exist:

- **No signature asset.** `SignatureMark.astro` draws vector strokes. The real
  feature needs an image an instructor uploads once (R2, referenced from
  `programRole`), plus a way for them to upload it.
- **No job title.** `programRole` stores only the enum (`INSTRUCTOR` / `TA`),
  not a printable title, so "Lead Instructor" is a prototype constant. Whichever
  design wins needs either a title column or a fixed mapping from the enum.
- **Only one instructor is ever shown.** `buildCertificateView` uses
  `programRoles.find(name === "INSTRUCTOR")`, so a program with co-instructors
  silently drops all but the first. C's two-signatory layout has no data behind
  it today, and a programme director is not modelled at all.
