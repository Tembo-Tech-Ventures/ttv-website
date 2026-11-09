# The TTV design system

How the TTV platform looks, reads and behaves, and the parts it is built
from. This folder is the engineering guide; the public guide at
[`/style-guide`](https://tembotechventures.com/style-guide) shows the same
system live, with every component rendered by the server exactly as the
platform renders it.

| Read | For |
|---|---|
| [foundations.md](foundations.md) | Colour, type, shape, surfaces, motion, icons: the tokens and their rules |
| [components.md](components.md) | Every part of the kit: API, when to use it, when not, accessibility |
| [patterns.md](patterns.md) | How the parts combine: the spaces frame, pages, forms, feedback, empty lists, filters, overlays |
| [voice.md](voice.md) | How TTV writes |

## Principles

1. **Know where you are.** The platform is a few spaces (Cohort, Community,
   Mentoring, Discover, Admin, Profile). Each is a sheet in its own tone, its
   tabs standing on it like a card file. People see only the spaces their
   roles open, always in the same order.
2. **People first, as themselves.** One look per person everywhere: their
   photo, or initials on a colour derived from their id. Builders are peach
   dots, mentors teal rings, institutions diamonds; Tembo, the AI, has a mark
   and never a face.
3. **One clear next step.** At most one peach (primary) action per view;
   everything beside it is quiet, the way out is a ghost.
4. **Words carry the meaning.** Reactions are words; counts are read with what
   they count; colour is never the only signal.
5. **Readable by everyone.** 4.5:1 for every word on every sheet and card,
   3:1 for every edge you need to find, 44px touch targets, no sideways scroll
   at 320px, everything essential without JavaScript, still under reduced
   motion. Tests check each of these (see [Testing](#testing)).
6. **Motion explains; it never performs.** Short, interruptible, and a cut
   under reduced motion. Decoration never implies that something happened.
7. **Honest by default.** Show what exists, label what is fictional or not
   ready, never invent outcomes.

## Where things live

| What | Where |
|---|---|
| The kit (components) | `src/components/platform/ui/`, imported from `@/components/platform/ui` |
| Class recipes (`buttonClass`, `pillClass`, `FOCUS_RING`, field classes) | `src/components/platform/ui/recipes.ts` |
| Tokens (colours, tracking, fonts) | the `@theme` block of `src/styles/global.css` |
| Tokens as data, and contrast arithmetic | `src/lib/design/tokens.ts`, `src/lib/design/contrast.ts` |
| Tab file and sheet geometry | `src/components/platform/ui/platform-ui.css` |
| The spaces shell built from the kit | `src/components/platform/shell/` ([README](../../src/components/platform/shell/README.md)) |
| The public style guide | `src/pages/style-guide/`, `src/components/style-guide/` |
| The dev-only primitives harness | `/dev/platform-ui` (`src/components/platform/ui/harness/`) |

## Using the kit

One import, for React islands and Astro pages alike:

```astro
---
import { Button, Notice, TextField } from "@/components/platform/ui";
---
<form method="POST">
  {error && <Notice tone="danger" focusOnLoad title={error} />}
  <TextField name="name" label="Your name" error={errors.name} required />
  <Button variant="primary" type="submit">Save</Button>
</form>
```

In an `.astro` file a kit component with no `client:` directive renders as
plain HTML and ships no JavaScript. Hydrate (`client:visible`, `client:load`)
only what must respond to a press.

Two things Astro cannot do with React components:

- **Pass JSX as a prop.** `<Button icon={<PiCheck />}>` in an `.astro` file
  hands React an Astro value, not a React element. Pass icons and other nodes
  from a small `.tsx` component instead, or use a named slot: Astro hands a
  React component each named slot as the prop of that name, so any node prop
  can be filled from `.astro` with `<Fragment slot="action">…</Fragment>`
  (`EmptyState`'s `action`, `Notice`'s `actions`, `PageHeader`'s `action`,
  `TabFile`'s `start` and `end`). Use `Fragment`, so the `slot` attribute does
  not land on the element inside. A slot inside a condition
  (`{show && <Fragment slot="action">…</Fragment>}`) still arrives, empty, when
  the condition fails; the kit's framed slots check for that (`filled`), so it
  draws no empty box.
- **Generate ids.** Each React component Astro renders is its own root, so
  `useId` would repeat across a page. The fields take their id from `id` or
  `name`, never from `useId`.

Where a component cannot go (a link inside server-rendered copy that must
look like a button, an `<a>` with a `class:list` of its own), use its recipe:
`buttonClass({ variant: "primary" })`. Never copy a component's classes by
hand: that is how the codebase came to have 74 hand-rolled buttons in 41
spellings.

## Older parts, and moving off them

The `form-control` utility in `global.css` predates the kit (as `components/common/Button.astro`, `Card.astro` and `Badge.astro` did; they are gone). Pages that already
use them are listed in `src/components/common/legacy-ui.test.ts`, which fails
if any other file starts using them, and also if a listed file stops using
them, so the lists only shrink. When you move a page onto the kit, delete its
line there.

| Older | Kit |
|---|---|
| `common/Button.astro` with `href` (removed) | `ButtonLink` |
| `common/Button.astro` without `href` (removed) | `Button` (`secondary` is `quiet`) |
| `common/Card.astro` (removed) | `Card` |
| `common/Badge.astro` (removed once its last page moved) | `Chip` with a status tone (`success`, `warning`, `danger`, or `neutral`/`peach`), or `RoleBadge` for a person's role |
| `class="form-control"` | `TextField`, `TextAreaField`, `SelectField` |
| hand-written red/green alert boxes | `Notice` |
| hand-written "Nothing here" paragraphs | `EmptyState` |
| link rows with `aria-current` (the old `ModerationTabs`) | `PillNav` |

## Adding to the kit

A new primitive earns its place when at least two features need it and it
has a clear contract. Before merging one:

1. Build it in `src/components/platform/ui/` from the recipes and tokens,
   with no new colours. If it needs a colour, add a token to `@theme` and to
   `COLOUR_GROUPS` in `src/lib/design/tokens.ts`.
2. Export it from `index.ts` (`kit.test.tsx` fails on any component file the
   entry point misses).
3. Unit-test its contract: semantics, names, states (`*.test.tsx` beside it).
4. If it draws text on a tint, add the tint to `contrast.test.ts`.
5. Add it to the public catalogue (`src/components/style-guide/catalogue.tsx`):
   `catalogue.test.tsx` fails until every export appears there.
6. Document it in [components.md](components.md).

## Testing

| Test | Proves |
|---|---|
| `src/components/platform/ui/contrast.test.ts` | Every ink, chip, notice, field edge and hover tint against every sheet and card, from the tokens themselves |
| `src/components/platform/ui/*.test.tsx`, `kit.test.tsx`, `Field.test.tsx` | Each primitive's semantics and states; the entry point exports every component |
| `src/lib/design/tokens.test.ts` | The style guide's token data matches `global.css` |
| `src/components/style-guide/catalogue.test.tsx` | The public catalogue covers every kit export and renders on the server |
| `src/pages/style-guide/_tests/style-guide.render.test.ts` | Each guide page's outline, tab file, contents, ids, landmarks and printed values |
| `src/components/common/legacy-ui.test.ts` | Nothing new uses the older parts |
| `e2e/style-guide.spec.ts` | axe at WCAG 2.2 AA, no sideways scroll from 320px, tab geometry, keyboard, no-JS, the live demonstrations, reduced motion |
| `e2e/platform-ui.spec.ts` | The primitives harness: geometry, contrast, focus, touch targets, reduced motion |
| `e2e/style-compliance.spec.ts` | Every signed-in route (`style-compliance.routes.ts`), as the person it is for: one h1 in the display face, at most one peach action, every control from the kit, axe WCAG 2.2 AA at 1440 and 320, 44px targets on a phone, no sideways scroll at 320. A route's `pending` checks are skipped, and against the local seed a pending check that passes fails, so delete it |
