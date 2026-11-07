# Components

Everything is imported from `@/components/platform/ui`. Each part below has a
live entry on the public guide's components page
(`/style-guide/components#<id>`); this page is the reference behind it.

Common to all of them: native elements first (a `button` is a `<button>`, a
link an `<a>`), the same focus ring (`FOCUS_RING`, peach ink, 2px, offset
2px), colour transitions only, `motion-reduce:transition-none`, and a 44px
target on touch screens.

## Actions

### Button `#button`

An action on this page. `<button type="button">` unless you pass `type="submit"`.

| Prop | Values | Default |
|---|---|---|
| `variant` | `primary`, `quiet`, `ghost`, `danger` | `quiet` |
| `size` | `sm` (32px), `md` (40px), `lg` (44px everywhere) | `md` |
| `icon` | leading node, hidden from assistive tech | |
| `loading` | `aria-busy`, says "working", keeps focus, ignores presses | `false` |
| `disabled` | every variant goes quiet the same way | |

- One `primary` per view. `quiet` for the alternatives, `ghost` for the way
  out, `danger` for removing or anything final.
- Words say what happens: "Send request", not "Submit".
- Never for navigation: that is `ButtonLink`.

`buttonClass({ variant, size, disabled, className })` is the same recipe for
an element that cannot be `Button` or `ButtonLink`. `Spinner` is its loading
mark, exported for the rare custom control that needs it.

### ButtonLink `#button-link`

A link that carries a button's weight. An `<a href>` with the button recipe;
same `variant` and `size`, plus `icon` and `trailingIcon`. There is no
disabled link: if the destination is closed, say why in words.

### IconButton `#icon-button`

A control with no room for words. `label` is required (it throws without
one) and is the whole accessible name.

| Prop | Use |
|---|---|
| `variant` | `quiet` (default), `ghost`, `primary` |
| `size` | `sm`, `md` |
| `pressed` | makes it a toggle (`aria-pressed`); pressed is ink |
| `badge` | a number (99+ past 99) or `"dot"`; joined into the name ("Attention, 4 waiting") |
| `badgeLabel`, `detail` | what the badge counts; extra words after it |

### Pill and PillNav `#pill`

- `Pill` (`pressed`, `count`) toggles a filter over what is already on the page.
- `PillNav` (`label`, `items: {label, href, current?, count?}[]`,
  `countLabel`) is a named `<nav>` of links for views with their own address.
  The current one is `aria-current="page"`; it throws if two are current.
- `pillClass(selected)` is the shared recipe.

For moving between spaces or whole sections, use the tab file instead.

## Labels and people

### Chip `#chip`

A static label, never a control. `tone`: `neutral` (facts), `peach` (needs
someone), `ring` (a mentor's part only), `success`, `warning`, `danger`
(outcomes, always in words). Text truncates inside the chip.
`CHIP_TONES` holds the tint and ink for each; every one is proven in
`contrast.test.ts`.

### CountBadge `#count-badge`

`count` with a `label` read after it ("3 new"); shows "99+" past `max` (99)
but reads the true number. `dot` for news without a number. Renders nothing
below 1, so pass the raw count. Only for things that need the person.

### RoleBadge `#role-badge`

Draws a `RoleBadge` from the contract (`{kind, label}`); the server owns the
words. Mentors get their ring, institutions their diamond, Tembo peach.
"TA" is read as "Teaching assistant".

### Avatar `#avatar`

`id`, `name`, optional `src`, `size` (`xs`–`xl`), `mentor` (the ring),
`decorative` (when the name is written beside it). Without a photo:
initials on a colour from `avatarColour(id)`, the same person the same colour
everywhere.

### PersonMarker and TemboMark `#markers`

`PersonMarker kind="builder" | "mentor" | "institution" | "tembo"`: the
network's shapes, all in one 12px box. Hidden unless given a `label`.
`TemboMark` is Tembo's T in Mattone, peach on dark teal; Tembo never wears an
avatar, and a person never wears the mark.

### TextReaction `#reaction`

A reaction in words ("Useful · 6"). With `onChange` it is a toggle that says
what to become (`onChange(!mine)`), so a retried request cannot undo itself;
without it, a read-only tally that never looks pressable.

## Surfaces

### Card `#card`

A raised surface on a sheet. `as` (`div`, `article`, `section`, `li`,
`aside`), `padding` (`sm`, `md`). No cards in cards.

### Sheet and TabFile `#tab-file`

- `Sheet space={tone}`: a page in a space's tone, rounded at the head. Set
  `--sheet-foot` on an ancestor to round its foot where it ends on the page.
- `TabFile`: index tabs standing on a sheet. `tabs: {id, label, href, tone,
  marker?, count?, unread?}[]`, `active`, `label` (the nav's name), optional
  `tone` (when no tab is current), `start`, `end`. Every tab is a link; it
  is navigation, not an ARIA tab widget.
- `SpaceFile`: the spaces as a `TabFile`, always in `SPACES` order with
  Profile last, each tab marked by its `SpaceGlyph` (Profile by the person's
  avatar). The spaces shell is built on it.

Nothing in the row covers anything else, at any width: the `end` tools move
above the tabs when they no longer fit; inactive tabs with markers fold to
their marker; a file without markers (`data-fold="off"`) keeps its words and
its strip scrolls, faded at the ends, opening on the active tab.

## Feedback

### Notice `#notice`

A message about the page or what just happened on it.

| Prop | Use |
|---|---|
| `tone` | `info` (default), `success`, `warning`, `danger` |
| `title` | the point in a few words |
| children | what happened and what to do next |
| `actions` | at most two buttons or links |
| `announce` | `assertive` (`role="alert"`), `polite` (`role="status"`), `none`. Defaults: danger assertive, success polite, info and warning none |
| `focusOnLoad` | lands focus on it when the page loads, as after a rejected submit; server-rendered, so no script is needed |
| `id`, `tabIndex={-1}` | for a page that moves focus to it by script |

The tone is said in words to screen readers ("Problem: …") and shown by an
icon, not by colour alone. A field's own error goes under the field, not in
a notice.

### EmptyState `#empty-state`

`title` (what is missing), children (why, and what fills it), `action` (one
next step), `mark` (decorative), `headingLevel` (2–4, default 3). It keeps
the list's place so the page does not jump when the first item arrives.

## Forms

### Fields `#fields`

`TextField` (`type`: text, email, url, tel, search, password, number, date,
time), `TextAreaField`, `SelectField` (`options`, `placeholder`), `Checkbox`,
and `ChoiceGroup` (a fieldset of radios, or checkboxes with
`type="checkbox"`). All take:

| Prop | Use |
|---|---|
| `label` | what the field is, in words; always visible, above the control |
| `hint` | what it is for or takes; read with the control |
| `error` | how to fix the value; marks it `aria-invalid` and is read with it |
| `optional` | adds "(optional)"; mark what can be skipped instead of starring what can't |
| `id` / `name` | the id comes from `id`, else `name`; never generated |

Every native attribute passes through (`required`, `autoComplete`,
`defaultValue`, `maxLength`…), so the browser's own validation runs first.
Controls have a 3:1 edge on every surface, a dark well, `scheme-dark` so the
browser's own parts match, and are 44px tall. `fieldAria(id, {hint, error})`
and `fieldId` are exported for a custom control that has to join the same
pattern.

## Recipes and tokens

`recipes.ts` holds the strings the components are made of: `FOCUS_RING`,
`BUTTON_VARIANTS`, `BUTTON_SIZES`, `buttonClass`, `pillClass`, `CONTROL`,
`CONTROL_HEIGHT`, `CHOICE_BOX`, `LABEL`, `HINT`, `FIELD_ERROR`. `tones.ts`
holds `CHIP_TONES` and `RAISED`. Use a recipe only where a component cannot
go, and never restate one by hand.
