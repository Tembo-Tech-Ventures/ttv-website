# Components

Everything is imported from `@/components/platform/ui`. Each part below has a
live entry on the public guide's components page
(`/style-guide/components#<id>`); this page is the reference behind it.

Common to all of them: native elements first (a `button` is a `<button>`, a
link an `<a>`), the same focus ring (`FOCUS_RING`, peach ink, 2px, offset
2px), colour transitions only, `motion-reduce:transition-none`, and a 44px
target on touch screens.

## The top of a page

### PageHeader and PageTitle `#page-header`

`PageTitle` is the page's one Mattone heading, its h1: 36–60px
(`sm:text-5xl lg:text-6xl`, easing from 28px at 320px to 36px by 400px, so
a long word such as "Applications" fits a phone's line), `tracking-heading`, balanced lines,
and a word too long for the line breaks rather than push the page sideways,
even in a flex row (`wrap-anywhere`). Line height 1.1 and 0.2em of room above
and below: Mattone's line box is 1.43em, so tighter type overhangs the h1,
and a browser hit-tests the overhang (it once took a back link's click). `id` names a
region by it; `as="p"` is only for showing a title as an example, as the
style guide does.

`PageHeader` is the title, the sentence under it and the page's one action:

| Prop | Use |
|---|---|
| `title` | the page's title, drawn by `PageTitle` |
| children | one sentence on what the page is for, when the title does not say it |
| `action` | the action the page exists for, as its one `primary`: a `ButtonLink`, or a `Button` in its form. From `.astro`, `<Fragment slot="action">` |
| `titleId`, `titleAs` | passed to the title |

The action sits beside the title from 40rem and under the sentence below
that, after the title in reading order at every width. Section headings below
are plain h2s: the base styles set every heading but the h1 in Maven Pro
bold, so they need no class. The public site's display h2s opt back in with
`font-display`.

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

`buttonClass({ variant, size, disabled, iconOnly, pressed, className })` is
the same recipe for an element that cannot be `Button` or `ButtonLink`;
`iconOnly` makes it square, `pressed` draws a toggle that is on in ink. `Spinner` is its loading
mark, exported for the rare custom control that needs it.

### ButtonLink `#button-link`

A link that carries a button's weight. An `<a href>` with the button recipe;
same `variant` and `size`, plus `icon` and `trailingIcon`. There is no
disabled link: if the destination is closed, say why in words.

### IconButton `#icon-button`

A control with no room for words. `label` is required (it throws without
one) and is the whole accessible name. It is built from `buttonClass({
iconOnly: true })`, so each variant looks as the same `Button` does, and it
is a 44px square on a touch screen.

| Prop | Use |
|---|---|
| `variant` | `quiet` (default), `ghost`, `primary`, `danger` |
| `size` | `sm` (32px), `md` (40px), `lg` (44px) |
| `pressed` | makes it a toggle (`aria-pressed`); pressed is ink |
| `badge` | a number (99+ past 99) or `"dot"`; joined into the name ("Attention, 4 waiting") |
| `badgeLabel`, `detail` | what the badge counts; extra words after it |

### Menu `#menu`

A few actions behind one button: a message's "more", a composer's "Share
project". The ARIA menu button, placed with CSS alone (no portal, no
floating library).

| Prop | Use |
|---|---|
| `label`, `icon`, `iconOnly` | the button: a ghost `Button` with words, or an `IconButton` named by `label` |
| `variant`, `size` | `ghost` (default) or `quiet`; `sm` (default) or `md` |
| `placement`, `align` | opens `bottom` (default) or `top`, lined up with the button's `start` or `end`; turns over when the box it scrolls in has no room |
| `triggerRef` | the button, for a caller that returns focus to it later |

`MenuItem` (`onSelect`, `disabled`, `icon`, `tone="danger"`) is one action;
`MenuSection heading` names a group of them, `MenuSeparator` is a hairline
between parts. Choosing an item closes the menu and returns focus to its
button before `onSelect` runs, so the action can move focus on. `MENU_ITEM`
(from `ui/Menu`) is the same look for an option in a list that is not a menu,
such as the clip finder's moments.

- Arrows, Home and End move; Enter or Space chooses; Escape closes and
  returns to the button; Tab or a press outside closes. Opened from the
  keyboard, the first item takes focus. Disabled items are read and skipped.
- The button is always visible: never revealed on hover.
- The list is the sheet's colour with a card's lift and a hairline: no shadow.

### Pill and PillNav `#pill`

- `Pill` (`pressed`, `count`) toggles a filter over what is already on the page.
- `PillNav` (`label`, `items: {label, href, current?, count?}[]`,
  `countLabel`) is a named `<nav>` of links for views with their own address.
  The current one is `aria-current="page"`; it throws if two are current.
- `pillClass(selected)` is the shared recipe.

For moving between spaces or whole sections, use the tab file instead.

### BackLink and linkClass `#back-link`

`BackLink` (`href`, children: the list's name, "Applications") is the way up
from a detail page, above its title: a quiet link with an arrow hidden from
screen readers, 44px on touch. `linkClass(className?)` is the recipe for a
link in running text: `ink-primary`, underlined, the focus ring. Never peach.

## Labels and people

### Chip `#chip`

A static label, never a control. `tone`: `neutral` (facts), `peach` (needs
someone), `ring` (a mentor's part only), `success`, `warning`, `danger`
(outcomes, always in words). Text truncates inside the chip.
`CHIP_TONES` holds the tint and ink for each; every one is proven in
`contrast.test.ts`.

### StatusChip `#status-chip`

`StatusChip domain status` draws a stored status as a `Chip` in its one name
and tone. `statusTone(domain, status)` returns `{ label, tone }` for places a
chip cannot go; `STATUSES` is the map. Domains: `application`, `access`,
`feedback`, `theme`, `studentFeedback` (a note as its author sees it, from
`studentFeedbackState`), `profile` (and blog posts), `contact` (a visitor's
message), `project`, `recording`, `token`. `APPROVED` is "Accepted" in every
domain. Waiting on a person is peach, an outcome takes a status tone,
everything else is neutral; no status wears the mentor's ring. `status.test.ts`
holds each domain to its schema column (`studentFeedback` to every state the
note and theme columns can make), so a new stored value cannot reach a page
without a name.

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

### DataTable `#data-table`

Many things side by side. Composed, so it works from `.astro`:
`<DataTable caption columns isEmpty empty>` holding `<DataRow>`s of
`<DataCell label>`s.

| Part | Use |
|---|---|
| `DataTable` | `caption` (read first; shown with `captionVisible`), `columns: { label, align?, hidden? }[]` in sentence case, `isEmpty` with an `EmptyState` in `empty` (from `.astro`, `<Fragment slot="empty">`) |
| `DataRow` | one thing; `current` lifts it a little |
| `DataCell` | `label` (its column, said beside it when the row stacks), `primary` for the cell that names the row (first; link it with `linkClass()`), `align` |
| `RowAction` | `href`, the words, and `row`: a quiet small link read as "Open Wanjiku Mwangi" |
| `DataSelectCell` | a row's selection box (`name`, `value`, `row`, `form`), named "Select Wanjiku Mwangi"; its column is `{ label: "Select", hidden: true }` |

Below 40rem each row stacks into a block that names each fact (`data-table.css`),
so nothing scrolls sideways at 320px; the table roles are written out so it is
still a table to a screen reader. Rows lift on hover; nothing in a row uses the
muted ink, which falls below 4.5:1 on that lift. On a touch screen the link in the `primary` cell is a
44px target, its press area handed back by a negative margin so no row moves.

### DataList `#data-list`

Things read one at a time: notes, themes, requests. `<DataList label isEmpty
empty>` of `<DataListItem title href meta status actions headingLevel>`,
children for a sentence more. The title is a heading and the link; `status`
and `actions` take named slots from `.astro`. Hairlines, not boxes.

### Pager `#pager`

`previousHref`, `nextHref` (either may be null), `summary` ("21–40 of 133"),
`label` when a page has more than one. A named nav of plain links with
`rel="prev"`/`"next"`; an end of the list has no link rather than a disabled
one, and a list on one page draws nothing. A list paged by cursor knows only
what comes after it, so it passes `firstHref` ("First page", `rel="first"`)
instead of a `previousHref` it would have to guess (the Members directory).

### DescriptionList `#description-list`

Facts about one thing, as name and value, in a real `<dl>` separated by
hairlines. `items={[{ term, detail }]}` for plain text, or `DescriptionItem
term` children for a detail that holds a link or a chip (both work from
`.astro`). The name stacks above the fact on a phone and stands in a 12rem
column beside it from 40rem; long values wrap.

### Disclosure `#disclosure`

Help or detail most readers can skip, behind one row: a native `<details>`
with a `summary`, so it opens without JavaScript and its state is announced.
The row is 44px on a touch screen, with the kit's focus ring, and a caret that
turns when it opens. `open` shows it on arrival (instructions before anything
is set up). Not for the page's main task, and never one inside another.

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
| `announce` | `assertive` (`role="alert"`), `polite` (`role="status"`), `none`. Defaults: danger assertive, success polite, info and warning none. A titled notice that is not announced is a `region` named by its title (`aria-labelledby` when it has an `id`) |
| `focusOnLoad` | lands focus on it when the page loads, as after a rejected submit; server-rendered, so no script is needed |
| `id`, `tabIndex={-1}` | for a page that moves focus to it by script |

The tone is said in words to screen readers ("Problem: …") and shown by an
icon, not by colour alone. A field's own error goes under the field, not in
a notice. From `.astro`, pass `actions` as `<Fragment slot="actions">`.

### EmptyState `#empty-state`

`title` (what is missing), children (why, and what fills it), `action` (one
next step; from `.astro`, `<Fragment slot="action">`), `mark` (decorative),
`headingLevel` (2–4, default 3). It keeps the list's place so the page does
not jump when the first item arrives.

### ConfirmStep `#confirm-step`

The step before something destructive, with no script (the pattern is in
patterns.md). `title` (the question, naming the thing), children (what
happens), `confirmLabel` (the danger button's words), `cancelHref`, `fields`
(hidden inputs the POST needs), `action` (where it posts; the page by
default), `focusOnLoad` (default on; off only for an example). The address
helpers are `confirmHref(url, action)`, `confirmingAction(url, offered)` and
`withoutConfirm(url)`, on the `confirm` parameter (`CONFIRM_PARAM`). The
buttons sit under the warning, not on its tint: a hovered danger button there
falls below 4.5:1 on four of the six sheets.

### Dialog `#dialog`

A question that has to be answered before anything else, asked without
leaving the page: for a React island that must keep its place, such as a
live call, where a page load would drop what is happening ("End for
everyone?", "Stop recording?"). Anywhere else, `ConfirmStep` asks the same
question without script and keeps its address.

| Prop | Use |
|---|---|
| `id` | required; names the title (`<id>-title`) and the words (`<id>-description`), and is what `dialogOpener(id)` opens |
| `title` | the question, naming the thing; an h2 |
| children | what happens, and whether it can be undone; read with the title |
| `actions` | the action asked about, a `danger` or `primary` `Button` (on a static page in its own `<form method="post">`; from `.astro`, `<Fragment slot="actions">`) |
| `cancelLabel` | the way out, which the dialog draws itself, first; "Cancel" by default |
| `open`, `onClose` | in an island, always: whether it is open, and the call when it closes by itself (Escape, the way out, the backdrop), never when `open` closed it |
| `initialFocus`, `returnFocus` | where focus starts (the first control by default) and where it goes back to (the control that opened it by default) |

- A native `<dialog>` opened as a modal: the page behind is inert and dimmed
  (`backdrop:bg-ground/60`), the box is the surrounding sheet's tone (the
  community sheet's outside one) with `shadow-overlay`, and it never scrolls sideways at 320px.
- In an island: focus moves to the first control, which is the way out when
  there is nothing to fill in, so Enter never does the irreversible thing by
  accident; Tab and Shift Tab stay inside (`cycleTab` in `focus.ts`, shared
  with the overlays' `useModalDialog`); Escape closes it unless a part inside,
  such as an open `Menu`, took the key first, or it ends an input method's
  composition; focus goes back to the opener, or to `returnFocus` when the
  opener is gone (a menu item), even if the dialog is taken away while open.
  A close event that arrives after it was opened again is ignored, and
  StrictMode's rehearsal unmount moves no focus.
- On a static page: `<Button {...dialogOpener(id)}>` is the browser's own
  invoker command (`commandfor`, `command="show-modal"`), and the way out is a
  `method="dialog"` form, so it opens, closes on Escape and returns focus with
  no script. Browsers without invoker commands (before 2025) can't open it,
  which is why `ConfirmStep` stays the default.
- Inside a `LiveAnnouncer` it carries the live regions while open through `open`, because a
  modal makes the page's own regions inert: a warning said behind it is still
  heard, and nothing said before it opened is said again.
- The way out and the action are kit buttons, so each is 44px on a touch screen.

### LiveAnnouncer `#live-announcer`

What a screen reader is told when something changes without a page load. One
per island, near its top, so its regions are in the page before anything is
said into them; it draws nothing visible.

| Part | Use |
|---|---|
| `LiveAnnouncer` | the polite region (an `output`) and the assertive one (`role="alert"`), and the announcer for everything inside. `voice` to share one made with `createLiveAnnouncer`, `options` for its pace, `name` for tests |
| `useAnnouncer()` | the nearest announcer, or null outside one |
| `say(message, { priority, key })` | says it once; `polite` by default, `assertive` only for what can't wait |
| `gather(key, item, { sentence, priority, id })` | collects a burst of the same event and says one sentence for all of it; `id` tells apart two people with the same name |
| `groupSentence(names, verb)` | "Kevin Omondi joined", "Kevin Omondi and Faith Njeri joined", "Kevin Omondi and 2 others joined" |

- The same words are said at most once in 5 seconds (`dedupeMs`), messages
  are at least a second apart (`throttleMs`), and assertive ones go ahead of
  polite ones still waiting. A burst waits 2 seconds (`gatherMs`) from its
  first item, and the same item twice counts once.
- Safe under StrictMode: remounted after its cleanup, it starts a fresh
  announcer. The assertive region is a plain `role="alert"`, so it is not
  announced twice.
- It has no clock of its own: it speaks only when asked, so nothing is said
  every second unless a caller asks every second. Don't.
- Each message is a fresh node keyed by its id, so a new message is always
  read and an old one never again. It is built on the platform's
  `createAnnouncer` (`lib/platform/client/announcer.ts`), which the attention
  and search overlays use too.
- Say what changed, in the voice's words: "Recording started", "You were muted
  by a host", "Connection lost". Never what the page showed on arrival.

### Countdown `#countdown`

When something ends for everyone and how long is left: "Ends at 19:02 · 12
min left". From the end time the server gave (`endsAt`); the server does the
ending, this only shows it and warns.

| Prop | Use |
|---|---|
| `endsAt` | the end, as epoch milliseconds or a `Date` |
| `warnings` | `"call"` (`CALL_WARNINGS`: 15 and 5 minutes politely, 1 minute and 10 seconds at once), `"check-in"` (`CHECK_IN_WARNINGS`: 10 and 5, then the same) or a list of `{ at, priority }` in seconds; none by default |
| `subject` | what ends, as the warnings say it: "The session ends in 5 minutes." Default "The call" |
| `showEndTime`, `timeZone` | "Ends at" first (default), in Africa/Nairobi time by default |
| `onEnd` | called once when the time is up |
| `now` | the clock, for tests and server-corrected time |
| `renderedAt` | when the server drew the page; without it the time left is drawn only once the browser's clock runs, so hydration never keeps a stale state |

- Tabular numerals. Whole minutes, rounded up, while more than one is left,
  so it changes once a minute and agrees with the warnings ("2 min left" at
  61 seconds, never "14 min left" just after "ends in 15 minutes"), and the end
  time is rounded up to the minute to match; then "0:42 left",
  each second, or in steps of ten seconds under reduced motion.
- Its time is a `timer`, which screen readers don't read as it changes. The
  warnings are said through the nearest `LiveAnnouncer`, each once. One more
  than 2 seconds past when it mounts is never said; when the end moves (the
  server corrects it), a warning stepped over by less than that is still said,
  one already said is not said again (even if a correction puts it back up to
  2 seconds ahead), and one the end moved back before by more than that is
  armed again. A tab that slept through several says only the most urgent.
- Secondary ink, then `warning-ink` from 5 minutes and `danger-ink` in the
  last minute, with the timer icon turning to a warning sign: the words always
  say how long, so colour is never the only signal. The ink changes as a cut
  under reduced motion.
- The limits it serves: a call ends at 90 minutes, its first warning at 75; a
  check-in ends at 30.

### SecretValue `#secret-value`

A secret shown once, in the response to the form that made it (no-store,
never a redirect): a Card region named by its h2 (`title`), what to do with it
now (children), the `value` in mono wrapping anywhere under `id`, a quiet copy
button saying what it copies (`copyLabel`) and how to use it (`usage`). The
page's script binds `[data-copy-secret]`, which holds the value's id; without
script the value is text to select. The admin's personal access tokens and
agent access pages use it.

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
browser's own parts match, and are 44px tall. A checkbox or radio is the
native input drawn by `choice.css` (`CHOICE_BOX`): a 20px box with the same
edge and well, peach with a dark tick or dot when chosen, a 44px target on a
touch screen (a transparent border, handed back by a negative margin, so the
row does not move), and the system's own drawing in forced colours.

`FileField` is the browser's file picker with its button drawn quiet; say in
`hint` the kinds of file and the size limit. `PrefixField` adds `prefix`, the
fixed start of the value ("tembotechventures.com/talent/"), shown before the
control, read with it and never sent; it wraps above the control on a narrow
screen. `ChoiceCard` is a radio or checkbox set as a card whose whole surface
is the label, for answers that need a sentence; `ChoiceGroup
appearance="cards"` lays a group of them two to a row from 40rem. Its hint
takes the secondary ink (`HINT_ON_TINT`), because the muted one falls below
4.5:1 on a chosen card. `fieldAria(id, {hint, error})`
and `fieldId` are exported for a custom control that has to join the same
pattern.

## Recipes and tokens

`recipes.ts` holds the strings the components are made of: `FOCUS_RING`
(and `INSET_FOCUS_RING`, the same ring drawn inside the edge for rows that fill
a menu or list), `BUTTON_VARIANTS`, `BUTTON_SIZES`, `buttonClass`, `linkClass`, `pillClass`, `CONTROL`,
`CONTROL_HEIGHT`, `CHOICE_BOX`, `LABEL`, `HINT`, `FIELD_ERROR`, all exported
from the kit's index. `tones.ts` holds `CHIP_TONES` and `RAISED`. Use a recipe
only where a component cannot go, and never restate one by hand.
