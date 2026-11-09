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

- Exactly one Mattone heading, the h1, from the kit's `PageHeader` (or
  `PageTitle` when the title says it all). Sections are plain h2s, which the
  base styles set in Maven Pro bold.
- A sentence under the title when the title does not say what the page is for
  (`PageHeader`'s children).
- The primary action before the long content it relates to (`PageHeader`'s
  `action`).
- Prose stops at about 70 characters a line (`max-w-prose`, `max-w-3xl`).
- Space first, a hairline second, a card third.
- Nothing only on hover: every action and fact is reachable by keyboard and
  touch. No information in tooltips or `title` attributes.

**Conversations are the one exception to the Mattone h1.** A channel or a
private conversation (`/dashboard/cohort/c/…`, `/dashboard/community/c/…`,
`/dashboard/community/dm/…`) is titled by the channel's or the person's name,
as a Maven Pro h1 (`font-body`, bold), and the page has no Mattone heading. The
name is a label people glance back at between messages, not the screen's
display moment: the conversation is. Its sections, such as the habits on a
first visit, are Maven h2s as on any page. (Decision D3, 2026-11-08;
`ChannelHeader` and `ConversationHeader`.)

## The immersive editor

Writing a post gives the whole screen to the post (`/dashboard/me/writing/new`,
`/dashboard/me/writing/[id]`). It is the one signed-in page outside the spaces
frame, and it keeps these rules instead (decision D4, 2026-11-08):

- `ImmersiveLayout` with `space="profile"`: no tabs or sidebar, but the
  viewport in the Profile sheet's tone, so the author is still in their space.
- One thin bar: a ghost `ButtonLink` back to Writing, the post's
  `StatusChip`, the save state, and `IconButton`s, with `Publish` as the one
  primary. On a phone the bar keeps its 44px targets by moving "Send feedback"
  into the settings panel, and a draft's chip with it.
- A named h1 ("New post", "Edit post"), visually hidden: the title the author
  types is the page's real heading, set in Mattone in the canvas.
- Why `Publish` is off is written beside it ("To publish: add a title") and
  tied to the button with `aria-describedby`, never only in a `title`.
- Formatting and the block menu are `IconButton`s; settings open in a panel
  built from kit fields, never a modal that hides the post.
- Without JavaScript, a plain kit form replaces the canvas, with the same
  actions and a `ConfirmStep` before a draft is deleted.

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
  on the notice (`focusOnLoad`, server-rendered, so it needs no script).
  Prefix the tab title with `titlePrefix="Error: "` on `SpacePage` or
  `AdminLayout`.
- A destructive action gets its own small form and a `danger` button, away
  from the main submit, and a confirm step (below) before it happens.
- On success, redirect (303) to the page's canonical address and show the new
  state. When the change is not visible where the person lands, say it once
  with a flash (below).

### Saying it once after a 303

`redirectWithFlash(Astro, location, { tone, title, message })` from
`@/lib/platform/server/flash` answers the POST with the 303 and a cookie
scoped to `location`; that page reads it with `takeFlash(Astro)`, which clears
it, and shows a `Notice` in its tone. A reload, the next POST and every other
page see nothing. Never put the message in the query string (`?notice=`): it
survives a reload and shows beside the next error. A failure never flashes; it
renders again with its errors.

```astro
---
if (Astro.request.method === "POST") {
  // validate and save…
  return redirectWithFlash(Astro, `/admin/programs/${id}`, { tone: "success", title: "Cohort updated" });
}
const flash = takeFlash(Astro);
---
{flash && <Notice tone={flash.tone} title={flash.title}>{flash.message}</Notice>}
```

### A confirm step without JavaScript

The destructive action is a link to the same page with `?confirm=<action>`
(`confirmHref(Astro.url, action)`). When `confirmingAction(Astro.url,
offered)` returns that action, the page draws a `ConfirmStep` where the
action was: a warning notice that names the thing and says what happens,
taking focus, then a form posting the hidden `fields` with a `danger` button
that says what it does and a ghost Cancel back to `withoutConfirm(Astro.url)`.
The buttons sit under the warning, never on its tint. Never `confirm()`. The
POST handler authorises as it always does; the step only asks.

Post forms to the page itself, and link to a confirm step with
`confirmHref` alone, never with a `#fragment`. A browser skips `autofocus`
when the address targets an element, so the confirm step, or a rejected
form's notice drawn in answer to a POST, would not take focus.
Focus scrolls the notice into view anyway, and a successful change's 303 can
still carry the fragment.

## Feedback

| Situation | Use |
|---|---|
| A form was rejected | Danger notice at the top, errors under fields, focus on the notice |
| A change was saved | The new state; a success notice only if the change is not visible where the person is looking |
| Something cannot be undone | A `ConfirmStep`: a warning that says what happens, then the danger button |
| The page is limited | An info notice where the limit applies |
| An island action failed | Say what failed, keep the input, offer the same action again |

One notice per region, at the top of what it is about. Never stack them.

## Detail pages

A `BackLink` to the list above the title, then a `PageHeader`, then the
thing's facts in a `DescriptionList`. A status is a `StatusChip`: each stored
status has one name everywhere (`statusTone`), so an application that was
`APPROVED` reads "Accepted" for the member and the admin alike.

## Links

A link inside a sentence takes `linkClass()`: the ink of the words around it,
underlined. Peach is the one primary action, never the colour of a link. A
link that carries a button's weight is a `ButtonLink`.

## Empty and waiting

An `EmptyState` says what belongs here and how it fills, with one next step
if there is one; never "Nothing here". From an `.astro` page, pass the step
as `<Fragment slot="action">` (a `Notice`'s as `<Fragment slot="actions">`). It keeps the list's place. Work in
progress keeps its place too: a `Button` with `loading`, never a page that
jumps or blanks.

## Lists and filters

Many things compared across columns are a `DataTable`: the first cell names
the row and links to it, actions are quiet `RowAction`s named by their row,
headers are sentence case, and an empty list is an `EmptyState` in its place.
Things read one at a time are a `DataList`. A list longer than a page ends in
a `Pager`. An action on several rows at once takes `DataSelectCell`s and one
button for the selection, with a confirm step if it removes anything.

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

The channel view is the documented exception. A conversation reads without a
script (its first page, thread and read marker are rendered on the server) and
agreeing to its habits is a plain form, but posting, editing, reacting,
reporting and moderating happen in the `ChannelView` island, and the composer
says so in a `<noscript>`.
