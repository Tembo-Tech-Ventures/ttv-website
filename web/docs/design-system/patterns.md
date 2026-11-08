# Patterns

How the parts combine. A pattern is a decision made once, so a mentor's
queue, an admin's review and a student's application behave the same way.
Each section has a live counterpart on `/style-guide/patterns`.

## The spaces frame

Every signed-in page with the `spaces` flag sits in `SpacesLayout`: the
TEMBO mark, the `SpaceFile` of the person's spaces with search and attention
beside it, and on the active sheet the space's sidebar (`SidebarHeader`,
`SidebarGroup`, `SidebarLink`) and the page. Below 64rem the tabs become a
bottom bar and the sidebar a drawer. The shell's own rules (guards, what may
reach the island, overlays, the sheet transition) are in
[the shell README](../../src/components/platform/shell/README.md).

## A page

- Exactly one Mattone heading, the h1 (`PageTitle` in pages that also render
  outside the spaces shell). Sections are Maven Pro h2s (`font-body`).
- A sentence under the title when the title does not say what the page is for.
- The primary action before the long content it relates to.
- Prose stops at about 70 characters a line (`max-w-prose`, `max-w-3xl`).
- Space first, a hairline second, a card third.
- Nothing only on hover: every action and fact is reachable by keyboard and
  touch. No information in tooltips or `title` attributes.

## Forms

Server-rendered forms that post (`<form method="POST">`, handled in the
page's frontmatter), built from the kit's fields.

```astro
---
import { Button, Notice, TextAreaField, ChoiceGroup } from "@/components/platform/ui";

const errors: Record<string, string> = {};
let values = { note: "", format: "" };
if (Astro.request.method === "POST") {
  const form = await Astro.request.formData();
  values = { note: String(form.get("note") ?? ""), format: String(form.get("format") ?? "") };
  if (!values.note.trim()) errors.note = "Write a sentence or two, so your mentor knows what you need.";
  if (!values.format) errors.format = "Choose how you would like to meet.";
  if (Object.keys(errors).length === 0) {
    // save, then redirect (303) so a refresh does not post again
  }
}
const count = Object.keys(errors).length;
---
<form method="POST">
  {count > 0 && (
    <Notice tone="danger" focusOnLoad title={`${count === 1 ? "One thing" : `${count} things`} to fix before this can go`}>
      Everything you wrote is kept.
    </Notice>
  )}
  <TextAreaField name="note" label="What would you like to talk about?" defaultValue={values.note} error={errors.note} required />
  <ChoiceGroup name="format" label="How would you like to meet?" options={FORMATS} defaultValue={values.format} error={errors.format} required />
  <Button variant="primary" type="submit">Send request</Button>
</form>
```

- Ask only for what you need; mark the rest `optional`.
- Validate on submit, never while someone types. The browser's own checks
  (`required`, `type="email"`) run first.
- A rejected submit re-renders with every value kept, a danger `Notice` at the
  top saying how many things to fix, an `error` under each field, and focus
  on the notice (`focusOnLoad`, server-rendered, so it needs no script). Prefix the tab title ("Error: ") as `SpacesLayout`'s
  `titlePrefix` does.
- A destructive action gets its own small form and a `danger` button, away
  from the main submit, with a `warning` notice saying what is final.
- On success, redirect (303) and show the new state.

## Feedback

| Situation | Use |
|---|---|
| A form was rejected | Danger notice at the top, errors under fields, focus on the notice |
| A change was saved | The new state; a success notice only if the change is not visible where the person is looking |
| Something cannot be undone | A warning notice before the action, then a confirming step |
| The page is limited | An info notice where the limit applies |
| An island action failed | Say what failed, keep the input, offer the same action again |

One notice per region, at the top of what it is about. Never stack them.

## Empty and waiting

An `EmptyState` says what belongs here and how it fills, with one next step
if there is one; never "Nothing here". It keeps the list's place. Work in
progress keeps its place too: a `Button` with `loading`, never a page that
jumps or blanks.

## Lists and filters

Views worth linking to are addresses: a `PillNav` of links, current view
`aria-current="page"`, working without JavaScript. Filters that only narrow
what is on screen are `Pill` toggles. More than five or six options: a
`SelectField`.

## Overlays

For quick tasks that keep their context (search, attention, a short drawer).
A task that matters gets its own page. Modals use
`components/platform/overlays/useModalDialog`: focus moves in on open, stays
inside, Escape closes, focus returns to the trigger, and the page behind is
inert and dimmed. Drawers slide from their own edge and are still under
reduced motion.

## Without JavaScript

Every page renders on the server and every essential task works without a
script. Menus are `<details>`; the sidebar drawer opens through its own link
(`:target`); views live in the address. A kit component in an `.astro` file
with no `client:` directive is HTML only. Hydrate only what must respond to a
press, and prefer `client:visible` below the fold.
