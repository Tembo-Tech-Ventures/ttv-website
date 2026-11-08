# Foundations

The tokens every TTV screen is drawn with. They live in the `@theme` block of
`src/styles/global.css`, which makes each one a Tailwind utility
(`--color-ink-muted` is `text-ink-muted`, `bg-ink-muted`, `border-ink-muted`).
Use the utility, never the raw value. `src/lib/design/tokens.ts` reads the
same file as text, so the public guide prints the values the site uses.

## Colour

### Brand

| Token | Value | Use |
|---|---|---|
| `primary` | `#F28D68` | Peach. The one primary action on a screen, builder dots, counts that need someone. Dark teal text on it (5.08:1), never white |
| `dark` | `#013D39` | Dark teal. The public site's ground, and the ink on peach |
| `teal` | `#2C6964` | Borders and translucent fills on the public site. Not a text surface: the quieter inks fall short of 4.5:1 on it |

### Ground and sheets

`ground` (`#01211F`) is behind everything in the platform. Each space is a
sheet on it, in its own tone: `sheet-cohort` (greener), `sheet-community`
(lightest), `sheet-mentoring` (bluer), `sheet-discover` (deeper),
`sheet-admin` (darkest), `sheet-profile` (warmer), plus `sheet-welcome` for
onboarding, which is not a space. The tones sit in a narrow lightness band
on purpose, so every ink below clears 4.5:1 on the lightest of them, and
differ in hue so a person can tell where they are.

Anything else drawn as a sheet borrows one of these tones (the style guide's
sections do). Never mix a new sheet colour: the contrast proofs cover exactly
these.

### Inks

| Token | Use | Never |
|---|---|---|
| `ink-primary` (`#FFF8F2`) | Headings, body, anything that must be read | |
| `ink-secondary` (72%) | Supporting text, inactive navigation | |
| `ink-muted` (64%) | Hints, timestamps, quiet labels | On a tint (a chip, a notice): it only clears AA on bare sheets and cards |
| `peach-ink` (`#FFB496`) | Peach as text; the focus ring | |
| `ring` (`#9FD3CA`) | Mentors: their ring and their role badge | As a status or decoration colour |
| `danger-ink` (`#FFB3A6`) | Failures, field errors, destructive actions | |
| `success-ink` (`#B7E4C7`) | Something worked | |
| `warning-ink` (`#FFD98E`) | A caution before something final | |

### Lines

`hairline` (10% ink) for card edges, dividers and quiet buttons; `rule` (20%
peach) for editorial dividers on the public site. A control's edge is not a
hairline: it is `ink-primary` at 45%, which clears 3:1 against every sheet
and card (WCAG 1.4.11), because a field you cannot find cannot be used.

### Older tokens

`bg-raised`, `surface` and `accent-bright` serve the public site and the
pre-spaces dashboard. Don't use them in new platform work.

## Type

| Role | Face | Size | Notes |
|---|---|---|---|
| Page title (h1) | Mattone Black | 36–60px | One per screen, from `PageTitle` or `PageHeader`. `tracking-heading` |
| Section (h2) | Maven Pro bold | 24–30px | The base styles set it: no class needed |
| Heading in a card (h3–h6) | Maven Pro bold | 16–18px | |
| Body | Maven Pro | 16px, `leading-relaxed` | Prose stops at about 70 characters a line |
| Small | Maven Pro | 14px | |
| Hint, caption | Maven Pro | 13px, `text-ink-muted` | |

Both faces are self-hosted from `src/assets/fonts/` under the SIL Open Font
License, and layouts preload Maven Pro's latin file (`FontPreload`).
Mattone appears in the kit only as the page title and Tembo's mark. The one
other place outside the h1 is the logo, the TEMBO wordmark at the start of the
spaces shell; its tagline beside it, "Tech Ventures", is Maven Pro in sentence
case. The public site's display h2s (the homepage's sections, `/hire`, the
blog) take it with `font-display`; on the platform an h2 never does.
Tracking comes from three tokens, `--tracking-display` (-0.02em), `--tracking-heading` (-0.015em) and
`--tracking-subhead` (-0.01em), never inline `letter-spacing`
(`src/styles/typography.test.ts`).

Sentence case everywhere. No capitals for emphasis, no eyebrows (small labels
above headings), no decorative section numbers.

## Shape and space

| Surface | Radius |
|---|---|
| Sheet | 1.75rem at the head, 1.25rem below 40rem; the foot is square unless `--sheet-foot` is set |
| Card, empty state | 1.125rem |
| Button (md, lg), field, notice | 0.75rem (`rounded-xl`) |
| Small button, icon button (sm) | 0.5rem (`rounded-lg`) |
| Chip, pill, count | full |

Space follows Tailwind's 4px grid: 4–8px inside a group (a label and its
field), 16–24px between groups (fields in a form, cards in a list), 48px and
up between sections, with a hairline above each. Separate with space first, a
hairline second, a card third.

Touch targets are 44px. Every kit control adds `pointer-coarse:min-h-11` (or
`size-11`), and one-line fields are `h-11` on every pointer.

## Surfaces

Three depths, each lighter than the one below: the **ground**, a **sheet**,
and a **card** (`RAISED`, `bg-ink-primary/4`, with a hairline) lifted in the
sheet's own light. A field is a dark well (`bg-ground/40`) set into whatever
holds it. Inside a sheet there are no drop shadows; the sheet itself casts a
soft shadow upward onto the ground. No cards inside cards.

Only what floats over the page casts a shadow, and only from the theme: the
account menu, search and attention take `--shadow-overlay` (`shadow-overlay`),
the open drawer `--shadow-drawer`. A scrim behind a drawer is the ground at
60% (`color-mix(in srgb, var(--color-ground) 60%, transparent)`), never black.

## Motion

| What | How |
|---|---|
| Hover, focus | Colour only, `duration-150`. Nothing moves or grows |
| Drawer | Slides from its own edge, 220ms |
| Changing space | A cross-document view transition: the new sheet rises 4.5rem over the old, 250ms, only when the sheet changes (`components/platform/shell/sheet-transition.ts`) |
| Working | `Spinner` turns only under `motion-safe` |
| Reduced motion | Every transition becomes a cut (`motion-reduce:transition-none`) |

Expressive motion on the public site (the homepage's sheets and map, the
community cards) follows the `ttv-ui-motion` skill in `.agents/skills/` and
[homepage.md](../homepage.md).

## Icons

Phosphor at its regular weight: `react-icons/pi` in the platform,
`@phosphor-icons/react` on the homepage. 20px (`size-5`) in controls, 16px
(`size-4`) inline. An icon beside words is `aria-hidden`; an icon alone is an
`IconButton`, which requires a label.
