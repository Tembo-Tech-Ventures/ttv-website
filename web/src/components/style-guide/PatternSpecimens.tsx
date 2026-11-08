import { PiBellSimple, PiMagnifyingGlass } from "react-icons/pi";
import { Button, ButtonLink, ChoiceGroup, EmptyState, IconButton, Notice, PersonMarker, TextAreaField, TextField } from "@/components/platform/ui";

/*
 * The patterns page's forms: one request, at rest and after a rejected submit.
 * They are not forms (nothing here posts anywhere), so their buttons are plain
 * buttons; on the platform the same fields sit in a `<form method="POST">`.
 */

const FORMATS = [
  { value: "call", label: "Video call" },
  { value: "chat", label: "Messages", hint: "In a direct conversation." },
];

export function RequestAtRest() {
  return (
    <div className="flex flex-col gap-5">
      <TextAreaField id="rest-note" name="rest-note" label="What would you like to talk about?" hint="A few sentences is plenty. David sees this first." rows={3} />
      <ChoiceGroup name="rest-format" label="How would you like to meet?" options={FORMATS} defaultValue="call" />
      <TextField id="rest-link" name="rest-link" type="url" label="A link to your work" optional />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary">Send request</Button>
        <Button variant="ghost">Cancel</Button>
      </div>
    </div>
  );
}

export function RequestRejected() {
  return (
    <div className="flex flex-col gap-5">
      <Notice tone="danger" title="Two things to fix before this can go" announce="none">
        Your note is kept. Fix the fields marked below and send it again.
      </Notice>
      <TextAreaField
        id="rejected-note"
        name="rejected-note"
        label="What would you like to talk about?"
        hint="A few sentences is plenty. David sees this first."
        error="Write a sentence or two, so David knows what you need."
        rows={3}
      />
      <ChoiceGroup name="rejected-format" label="How would you like to meet?" options={FORMATS} error="Choose how you would like to meet." />
      <TextField id="rejected-link" name="rejected-link" type="url" label="A link to your work" optional defaultValue="https://github.com/example/fare-splitter" />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="primary">Send request</Button>
        <Button variant="ghost">Cancel</Button>
      </div>
    </div>
  );
}

/** The frame's tools, beside the tabs: search, and attention with what is waiting. */
export function FrameTools() {
  return (
    <span className="flex gap-2 pr-1 pt-1">
      <IconButton label="Search" icon={<PiMagnifyingGlass className="size-5" />} size="sm" />
      <IconButton label="Attention" icon={<PiBellSimple className="size-5" />} size="sm" badge={2} badgeLabel="waiting" />
    </span>
  );
}

export function EmptyExamples() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <EmptyState
        title="Nobody has asked yet"
        mark={<PersonMarker kind="builder" className="scale-150" />}
        action={
          <ButtonLink href="#empty" size="sm">
            Update your availability
          </ButtonLink>
        }
      >
        When a builder asks you for time, their request waits here with their note and their work.
      </EmptyState>
      <EmptyState title="No messages match “ledger”">Try fewer words, or search every channel you can read.</EmptyState>
    </div>
  );
}
