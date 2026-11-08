import type { ReactNode } from "react";
import { PiArrowRight, PiBellSimple, PiCheck, PiMagnifyingGlass, PiPaperPlaneTilt, PiPushPin, PiTrash } from "react-icons/pi";
import {
  Avatar,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Chip,
  ChoiceGroup,
  CountBadge,
  EmptyState,
  IconButton,
  Notice,
  PageHeader,
  PageTitle,
  PersonMarker,
  PillNav,
  RoleBadge,
  SelectField,
  SpaceFile,
  TabFile,
  TemboMark,
  TextAreaField,
  TextField,
  TextReaction,
} from "@/components/platform/ui";
import type { LiveDemo } from "./LiveSpecimen";
import { GUIDE_PEOPLE, PHOTO } from "./people";

/*
 * The components page, one entry per part of the kit. Every specimen is the
 * real component, rendered on the server exactly as the platform renders it.
 * kit-coverage.test.ts fails if a component in the kit has no entry here.
 */

export type CatalogueEntry = {
  id: string;
  name: string;
  /** The kit exports this entry shows. */
  exports: readonly string[];
  summary: string;
  specimen: () => ReactNode;
  /** A demonstration to press, hydrated beside the specimen. */
  live?: LiveDemo;
  use: readonly string[];
  avoid: readonly string[];
  access: readonly string[];
  code: string;
};

const { wanjiku, david, joseph, lucy } = GUIDE_PEOPLE;

function Row({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {label && <p className="m-0 text-xs font-semibold text-ink-muted">{label}</p>}
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Specimens({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-6">{children}</div>;
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: "page-header",
    name: "PageHeader and PageTitle",
    exports: ["PageHeader", "PageTitle"],
    summary: "The top of a page: its one Mattone title, a sentence on what the page is for, and the action the page exists for.",
    specimen: () => (
      <Specimens>
        <Row label="PageHeader">
          <PageHeader
            title="Mentor requests"
            titleAs="p"
            className="w-full"
            action={
              <ButtonLink href="#page-header" variant="primary" icon={<PiMagnifyingGlass />}>
                Find a mentor
              </ButtonLink>
            }
          >
            The mentors you asked for time, and what each one said.
          </PageHeader>
        </Row>
        <Row label="PageTitle alone">
          <PageTitle as="p">Account</PageTitle>
        </Row>
      </Specimens>
    ),
    use: [
      "Every page, once, at the top: PageHeader when there is a sentence or an action, PageTitle when the title says it all.",
      "The action the page exists for, as its one primary: “New program”, “Find a mentor”.",
      "Section headings below it as plain h2s: the base styles set them in Maven Pro bold.",
    ],
    avoid: [
      "A second Mattone heading on the page, or Mattone for a section.",
      "More than one action in the header. The others belong with what they act on.",
      "A peach action that leads to an empty list. Lead with what fills it.",
    ],
    access: [
      "The title is the page's only h1, so a screen reader's heading list starts with it.",
      "Long words wrap rather than push the page sideways at 320px.",
      "The action comes after the title and sentence in reading order at every width.",
    ],
    code: `---
import { ButtonLink, PageHeader } from "@/components/platform/ui";
---
<PageHeader title="Mentor requests">
  The people who asked you for time, newest first.
  <Fragment slot="action">
    <ButtonLink variant="primary" href="/dashboard/mentoring/availability">Set your availability</ButtonLink>
  </Fragment>
</PageHeader>`,
  },
  {
    id: "button",
    name: "Button",
    exports: ["Button", "Spinner", "buttonClass"],
    live: "button",
    summary: "An action on this page: send, save, accept. One primary per view; everything else is quiet or ghost.",
    specimen: () => (
      <Specimens>
        <Row label="Variants">
          <Button variant="primary" icon={<PiPaperPlaneTilt />}>
            Ask for time
          </Button>
          <Button>Save draft</Button>
          <Button variant="ghost">Not now</Button>
          <Button variant="danger" icon={<PiTrash />}>
            Remove
          </Button>
        </Row>
        <Row label="States">
          <Button variant="primary" loading>
            Sending
          </Button>
          <Button variant="primary" disabled>
            Ask for time
          </Button>
        </Row>
        <Row label="Sizes: sm, md, lg">
          <Button size="sm">Reply</Button>
          <Button size="md">Reply</Button>
          <Button size="lg">Reply</Button>
        </Row>
      </Specimens>
    ),
    use: [
      "The action someone came to take, as the one primary button.",
      "Quiet for the actions beside it, ghost for a way out: “Not now”, “Cancel”.",
      "Danger only for something that removes or cannot be undone.",
      "lg where a thumb lands first: the top of a page, a card's main action.",
    ],
    avoid: [
      "Going somewhere else. That is a link: use ButtonLink.",
      "Two primary buttons side by side. If both matter, one of them is quiet.",
      "Vague words such as “Submit” or “OK”. Say what happens: “Send request”.",
    ],
    access: [
      "Loading keeps focus: it is aria-busy, says “working”, and ignores further presses.",
      "Every size grows to a 44px target on a touch screen.",
      "The words are the name; an icon beside them is hidden from screen readers.",
    ],
    code: `<Button variant="primary" type="submit">Ask for time</Button>
<Button variant="ghost">Not now</Button>
<Button variant="primary" loading={sending}>Sending</Button>`,
  },
  {
    id: "button-link",
    name: "ButtonLink",
    exports: ["ButtonLink"],
    summary: "A link that carries the weight of a button: “Open Mentoring”, “Find a mentor”. It goes somewhere, so it stays a link.",
    specimen: () => (
      <Specimens>
        <Row>
          <ButtonLink href="#button-link" variant="primary" trailingIcon={<PiArrowRight />}>
            Find a mentor
          </ButtonLink>
          <ButtonLink href="#button-link">Open your profile</ButtonLink>
          <ButtonLink href="#button-link" variant="ghost">
            Read the code of conduct
          </ButtonLink>
        </Row>
      </Specimens>
    ),
    use: ["The next place to go, when it is the point of the card or page.", "Any button-shaped control that changes the address."],
    avoid: [
      "Changing something on this page. That is a Button in a form.",
      "A disabled link. If the destination is not open yet, say why in words instead.",
    ],
    access: ["It is an a element: it opens in a new tab, can be copied and works without JavaScript."],
    code: `<ButtonLink href="/dashboard/community/mentors" variant="primary">Find a mentor</ButtonLink>`,
  },
  {
    id: "icon-button",
    name: "IconButton",
    exports: ["IconButton"],
    live: "icon-button",
    summary: "A control with no room for words: search, attention, pin. Its label is its whole name.",
    specimen: () => (
      <Specimens>
        <Row>
          <IconButton label="Search" icon={<PiMagnifyingGlass className="size-5" />} />
          <IconButton label="Attention" icon={<PiBellSimple className="size-5" />} badge={4} badgeLabel="waiting" />
          <IconButton label="Pin this message" icon={<PiPushPin className="size-5" />} pressed />
          <IconButton label="Mark as done" icon={<PiCheck className="size-5" />} variant="ghost" size="sm" />
        </Row>
      </Specimens>
    ),
    use: ["Toolbars and dense rows where the icon is widely understood.", "Toggles, with pressed on or off."],
    avoid: ["The main action on a page. Words are clearer: use Button with an icon."],
    access: [
      "The label is required, and the component refuses to render without one.",
      "A badge joins the name, “Attention, 4 waiting”, because a badge inside a labelled button is never read.",
    ],
    code: `<IconButton label="Attention" icon={<PiBellSimple />} badge={count} badgeLabel="waiting" />`,
  },
  {
    id: "pill",
    name: "Pill and PillNav",
    exports: ["Pill", "PillNav", "pillClass"],
    live: "pill",
    summary: "Pills choose what you see. Pill toggles a filter on this page; PillNav moves between views that have their own address.",
    specimen: () => (
      <Specimens>
        <Row label="PillNav: views with their own address">
          <PillNav
            label="Request lists"
            items={[
              { label: "Waiting", href: "#pill", current: true, count: 2 },
              { label: "Accepted", href: "#pill" },
              { label: "Closed", href: "#pill" },
            ]}
          />
        </Row>
      </Specimens>
    ),
    use: ["A few filters over one list.", "Two to five views of a queue, each a link that works without JavaScript."],
    avoid: ["Moving between spaces or whole sections: that is the tab file.", "More than five or six options: use a select."],
    access: ["Pill is aria-pressed; PillNav marks its current view aria-current=page.", "Counts are read with what they count."],
    code: `<Pill pressed={filter === "open"} count={open} onClick={() => setFilter("open")}>Needs a decision</Pill>

<PillNav label="Moderation lists" items={[
  { label: "Needs a decision", href: "/admin/moderation", current: true, count: 3 },
  { label: "Decided", href: "/admin/moderation?state=DECIDED" },
]} />`,
  },
  {
    id: "chip",
    name: "Chip",
    exports: ["Chip", "CHIP_TONES"],
    summary: "A small static label: a skill, a source, a status. Not a control.",
    specimen: () => (
      <Specimens>
        <Row>
          <Chip>React</Chip>
          <Chip>Data analysis</Chip>
          <Chip tone="peach">Needs you</Chip>
          <Chip tone="ring">Confirmed by a mentor</Chip>
        </Row>
        <Row label="Status">
          <Chip tone="success">Approved</Chip>
          <Chip tone="warning">Being checked</Chip>
          <Chip tone="danger">Declined</Chip>
        </Row>
      </Specimens>
    ),
    use: [
      "Neutral for facts, peach for something that needs the reader, ring only for a mentor's part.",
      "Success, warning and danger for an outcome, always in words: “Approved”, never a green dot.",
    ],
    avoid: ["Anything pressable. A chip that looks like a button but does nothing breaks trust; use Pill."],
    access: ["Long text truncates inside the chip, so a chip never pushes its row wider than the screen."],
    code: `<Chip tone="ring">Confirmed by a mentor</Chip>`,
  },
  {
    id: "count-badge",
    name: "CountBadge",
    exports: ["CountBadge"],
    summary: "How many things are waiting, in peach. A dot when something is new but a number would not help.",
    specimen: () => (
      <Specimens>
        <Row>
          <CountBadge count={3} label="new" />
          <CountBadge count={12} label="unread messages" />
          <CountBadge count={240} label="waiting" />
          <CountBadge dot label="new activity" />
        </Row>
      </Specimens>
    ),
    use: ["Unread messages, waiting requests: counts of things that need the person."],
    avoid: ["Totals that need nothing, such as members in a channel. Write those as text."],
    access: ["The number is read with its meaning, “3 new”; past 99 it shows “99+” and reads the true count."],
    code: `<CountBadge count={unread} label="unread messages" />`,
  },
  {
    id: "role-badge",
    name: "RoleBadge",
    exports: ["RoleBadge"],
    summary: "The role a person speaks with, beside their name. The server words it; the badge only draws it.",
    specimen: () => (
      <Specimens>
        <Row>
          {wanjiku.roleBadges.map((badge) => (
            <RoleBadge key={badge.kind} badge={badge} />
          ))}
          {david.roleBadges.map((badge) => (
            <RoleBadge key={badge.kind} badge={badge} />
          ))}
          {joseph.roleBadges.map((badge) => (
            <RoleBadge key={badge.kind} badge={badge} />
          ))}
          <RoleBadge badge={{ kind: "TA", label: "TA" }} />
          <RoleBadge badge={{ kind: "AI", label: "AI" }} />
        </Row>
      </Specimens>
    ),
    use: ["Next to an author's name in a thread, a request or a list of people."],
    avoid: ["Inventing wording in the page. If a role needs new words, they change on the server, once."],
    access: ["Abbreviations are said in full: TA is read as “Teaching assistant”."],
    code: `{author.roleBadges.map((badge) => <RoleBadge badge={badge} />)}`,
  },
  {
    id: "avatar",
    name: "Avatar",
    exports: ["Avatar", "avatarColour", "initials"],
    summary: "A person's photo, or their initials on a colour taken from their id, so they look the same in every list.",
    specimen: () => (
      <Specimens>
        <Row label="Sizes: xs, sm, md, lg, xl">
          {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
            <Avatar key={size} id={wanjiku.id} name={wanjiku.name} size={size} />
          ))}
        </Row>
        <Row label="Initials, a mentor's ring, a photo">
          <Avatar id={lucy.id} name={lucy.name} size="lg" />
          <Avatar id={david.id} name={david.name} size="lg" mentor />
          <Avatar id={joseph.id} name={joseph.name} size="lg" src={PHOTO} />
        </Row>
      </Specimens>
    ),
    use: ["Wherever a person acts or is listed. Mentors wear the ring, as they do on the homepage's map."],
    avoid: ["Colour by position in a list. The colour belongs to the person, from their id."],
    access: ["Set decorative when the name is written beside it, so it is not read twice."],
    code: `<Avatar id={person.id} name={person.name} src={person.avatarUrl ?? undefined} mentor={isMentor} decorative />`,
  },
  {
    id: "markers",
    name: "PersonMarker and TemboMark",
    exports: ["PersonMarker", "TemboMark"],
    summary:
      "The network's shapes: builders are peach dots, mentors teal rings, institutions diamonds. Tembo, the AI, has a mark rather than a face, so it is never mistaken for a person.",
    specimen: () => (
      <Specimens>
        <Row>
          {(
            [
              ["builder", "Builder"],
              ["mentor", "Mentor"],
              ["institution", "Institution"],
            ] as const
          ).map(([kind, name]) => (
            <span key={kind} className="inline-flex items-center gap-2 text-sm text-ink-secondary">
              <PersonMarker kind={kind} />
              {name}
            </span>
          ))}
          <span className="inline-flex items-center gap-2 text-sm text-ink-secondary">
            <TemboMark size="sm" decorative />
            Tembo
          </span>
        </Row>
      </Specimens>
    ),
    use: ["Telling kinds of people apart at a glance: in a legend, a list, a role."],
    avoid: [
      "Decoration that suggests something happened. A ring means a mentor, never “checked” or “done”.",
      "A person's avatar for Tembo, or Tembo's mark for a person.",
    ],
    access: ["Hidden from screen readers unless given a label, because the words beside them usually say it."],
    code: `<PersonMarker kind="mentor" label="Mentor" />
<TemboMark size="sm" />`,
  },
  {
    id: "reaction",
    name: "TextReaction",
    exports: ["TextReaction", "REACTIONS"],
    live: "reaction",
    summary: "A reaction in words, not emoji: “Useful · 6”. Words say what a reaction means and keep the conversation's register.",
    specimen: () => (
      <Specimens>
        <Row label="A read-only tally">
          <TextReaction kind="useful" count={6} mine />
          <TextReaction kind="learned" count={2} />
          <TextReaction kind="thanks" count={1} />
        </Row>
      </Specimens>
    ),
    use: ["The five fixed reactions under a message."],
    avoid: ["A reaction that looks pressable where it cannot be pressed: without onChange it is a plain tally."],
    access: ["Reads as “Useful, 6 people, including you”, and toggles with aria-pressed."],
    code: `<TextReaction kind="useful" count={6} mine={mine} onChange={(active) => react("useful", active)} />`,
  },
  {
    id: "card",
    name: "Card",
    exports: ["Card", "RAISED"],
    summary: "A raised surface on a sheet: a request, an embed, a profile summary. A faint lift in the sheet's own light, never a new colour.",
    specimen: () => (
      <Specimens>
        <Card as="article" className="max-w-md">
          <div className="flex items-center gap-3">
            <Avatar id={wanjiku.id} name={wanjiku.name} decorative />
            <div className="min-w-0">
              <p className="m-0 font-semibold text-ink-primary">{wanjiku.name}</p>
              <p className="m-0 text-sm text-ink-muted">Asked for 30 minutes about an M-Pesa reconciliation project</p>
            </div>
          </div>
          <p className="mt-3 mb-0 text-sm leading-relaxed text-ink-secondary">
            I have the ledger matching working, but I am not sure my tests cover reversed payments.
          </p>
        </Card>
      </Specimens>
    ),
    use: ["One thing a person can read or act on as a unit."],
    avoid: ["Cards inside cards. If a card needs sections, use spacing and hairlines inside it."],
    access: ["Pick the element for what it is: article for a self-contained item, li in a list."],
    code: `<Card as="article" aria-labelledby="request-title">…</Card>`,
  },
  {
    id: "notice",
    name: "Notice",
    exports: ["Notice"],
    summary: "A message about the page or what just happened on it, in one of four tones. One per region, at the top of what it is about.",
    specimen: () => (
      <Specimens>
        <Notice tone="danger" title="We couldn't send your request" announce="none">
          Your note is saved. Check your connection and send it again.
        </Notice>
        <Notice tone="success" announce="none">
          Request sent. David will see it in Mentoring.
        </Notice>
        <Notice tone="warning" title="This removes the request for good" />
        <Notice tone="info">This channel is read-only after the cohort ends. You can still read and search it.</Notice>
      </Specimens>
    ),
    use: ["A rejected form (danger, at the top, with errors under each field too).", "A saved change (success).", "A caution before something final (warning)."],
    avoid: ["A field's own error: that sits under the field.", "Notices stacked three deep. Say it once, where it applies."],
    access: [
      "Failures interrupt (role=alert); confirmations wait their turn (role=status); information is simply part of the page.",
      "The tone is said in words and shown by an icon, never by colour alone.",
      "After a rejected submit, focusOnLoad lands the reader on it, with no script needed.",
    ],
    code: `<Notice tone="danger" focusOnLoad title="We couldn't send your request">
  Check the two fields marked below.
</Notice>`,
  },
  {
    id: "empty-state",
    name: "EmptyState",
    exports: ["EmptyState"],
    summary: "The place a list will be. It says what belongs here and how it gets filled, never just “Nothing here”.",
    specimen: () => (
      <EmptyState
        title="No requests yet"
        mark={<PersonMarker kind="mentor" className="scale-150" />}
        action={
          <ButtonLink href="#empty-state" size="sm">
            Find a mentor
          </ButtonLink>
        }
      >
        When you ask a mentor for time, the request waits here until they answer.
      </EmptyState>
    ),
    use: ["An empty queue, list or search, in the list's own place on the sheet."],
    avoid: ["Jokes or illustrations that take longer to read than the sentence that helps."],
    access: ["Its heading level is set to fit the page's outline (h3 by default)."],
    code: `<EmptyState title="No requests yet" action={<ButtonLink href="/dashboard/community/mentors">Find a mentor</ButtonLink>}>
  When you ask a mentor for time, the request waits here until they answer.
</EmptyState>`,
  },
  {
    id: "fields",
    name: "Fields",
    exports: ["TextField", "TextAreaField", "SelectField", "Checkbox", "ChoiceGroup"],
    summary: "Labelled form controls: a label above, a hint under it, and after a rejected submit an error that says how to fix it.",
    specimen: () => (
      <div className="grid max-w-xl gap-5">
        <TextField id="guide-name" name="guide-name" label="Your name" autoComplete="name" defaultValue="Wanjiku Mwangi" />
        <TextField
          id="guide-email"
          name="guide-email"
          type="email"
          label="Email"
          hint="Mentors reply here."
          error="Enter an email address, like wanjiku@example.com."
          defaultValue="wanjiku@"
        />
        <TextAreaField id="guide-note" name="guide-note" label="What would you like to talk about?" hint="A few sentences is plenty." rows={3} />
        <SelectField
          id="guide-month"
          name="guide-month"
          label="When"
          placeholder="Choose a month"
          options={[
            { value: "nov", label: "November" },
            { value: "dec", label: "December" },
          ]}
        />
        <ChoiceGroup
          name="guide-format"
          label="How would you like to meet?"
          defaultValue="call"
          options={[
            { value: "call", label: "Video call" },
            { value: "chat", label: "Messages", hint: "In a direct conversation." },
          ]}
        />
        <Checkbox id="guide-conduct" name="guide-conduct" label="I agree to the code of conduct" />
      </div>
    ),
    use: [
      "Every form, in React islands and in server-rendered Astro forms alike.",
      "Radios for one of a few answers worth reading side by side; a select past six or seven.",
      "Mark the fields people may skip as optional, rather than starring the rest.",
    ],
    avoid: ["Placeholders as labels: they vanish as soon as someone types.", "Validating while someone is still typing."],
    access: [
      "Labels are linked by id, which comes from id or name and is never generated.",
      "Hints and errors are read with the control (aria-describedby); errors mark it aria-invalid.",
      "Edges are 3:1 against every sheet; one-line controls are a 44px target.",
    ],
    code: `<form method="POST">
  <TextField name="email" type="email" label="Email" hint="Mentors reply here." error={errors.email} required />
  <ChoiceGroup name="format" label="How would you like to meet?" options={FORMATS} defaultValue={values.format} />
  <Button variant="primary" type="submit">Send request</Button>
</form>`,
  },
  {
    id: "tab-file",
    name: "Sheet and tab file",
    exports: ["Sheet", "TabFile", "SpaceFile", "SpaceGlyph", "SPACES"],
    summary:
      "The platform's frame. Each space is a sheet in its own tone; its tabs stand on the sheet like the index tabs of a card file, the active one raised and joined to the page.",
    specimen: () => (
      <div className="flex min-w-0 flex-col gap-8">
        <div className="-mx-2 min-w-0 rounded-[1.25rem] bg-ground px-1.5 pt-5 pb-1.5 [--sheet-foot:1rem] sm:mx-0 sm:px-4 sm:pb-4">
          <SpaceFile
            label="Wanjiku's spaces"
            active="community"
            person={{ id: wanjiku.id, name: wanjiku.name }}
            tabs={[
              { space: "cohort", label: "Cohort", href: "#tab-file", count: 2 },
              { space: "community", label: "Community", href: "#tab-file" },
              { space: "profile", label: "Profile", href: "#tab-file", unread: true },
            ]}
          >
            <div className="px-5 pt-6 pb-8 sm:px-7">
              <p className="m-0 text-lg font-bold text-ink-primary">What's new</p>
              <p className="mt-1 mb-0 text-sm text-ink-secondary">The Community sheet. Cohort waits behind it with two new things.</p>
            </div>
          </SpaceFile>
        </div>
        <div className="-mx-2 min-w-0 rounded-[1.25rem] bg-ground px-1.5 pt-5 pb-1.5 [--sheet-foot:1rem] sm:mx-0 sm:px-4 sm:pb-4">
          <TabFile
            label="Request views"
            active="waiting"
            tabs={[
              { id: "waiting", label: "Waiting", href: "#tab-file", tone: "mentoring", count: 2 },
              { id: "history", label: "History", href: "#tab-file", tone: "discover" },
            ]}
          >
            <div className="px-5 pt-6 pb-8 sm:px-7">
              <p className="m-0 text-sm text-ink-secondary">A TabFile with tabs of its own, borrowing two sheet tones.</p>
            </div>
          </TabFile>
        </div>
      </div>
    ),
    use: [
      "SpaceFile for the spaces shell: spaces always in the same order, Profile last, each with its glyph.",
      "TabFile for a handful of sibling pages that each deserve a sheet, such as this guide.",
      "Sheet alone for a space's page outside the shell.",
    ],
    avoid: [
      "Tabs that swap content without changing the address. Each tab is a link to a page.",
      "New sheet colours. Borrow a tone: every ink is proven on exactly these.",
      "More than six tabs. Past that, the row stops being a place you can take in at a glance.",
    ],
    access: [
      "It is navigation, not an ARIA tab widget: a named nav of links, the active one aria-current=page.",
      "Nothing in the row covers anything else at any width: the tools move above, inactive tabs fold to their marker, and last the strip scrolls inside its own bounds.",
      "Under reduced motion, moving between sheets is a plain cut.",
    ],
    code: `<TabFile label="Style guide" active="components" tabs={[
  { id: "principles", label: "Principles", href: "/style-guide", tone: "community" },
  { id: "components", label: "Components", href: "/style-guide/components", tone: "mentoring" },
]}>
  …the page…
</TabFile>`,
  },
];
