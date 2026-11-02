import { useEffect, useId, useRef, type FormEvent } from "react";
import { PiCheckCircle, PiFolderSimple, PiShieldCheck, PiX } from "react-icons/pi";
import type { MentorDirectoryItem, MentorRequest, ProjectEmbed } from "@/lib/platform/contracts";
import { useRequestForm } from "@/lib/platform/client/hooks/mentoring";
import { MAX_NOTE, type RequestFailure, type RequestFormStore } from "@/lib/platform/client/mentor-request-form";
import { firstName } from "@/components/channels/channel-format";
import { CONDUCT_INTENT } from "@/components/channels/conduct-flow";
import { CONDUCT_TITLE } from "@/components/channels/conduct";
import { Avatar, Button, IconButton } from "@/components/platform/ui";
import { BUTTON_VARIANTS, FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { FORMAT_HINTS, FORMAT_LABELS, NOT_MEMBER_REASON } from "./mentor-display";
import { projectValue, REQUEST_INTENT } from "./request-post";

/** Where agreeing to the habits posts (this page, drawer open) and where to read them first. */
export interface ConductPrompt {
  action: string;
  version: number;
  habitsHref: string;
  /** False for an agent's delegated session, which may never agree for the person. */
  canAgree: boolean;
}

interface Props {
  store: RequestFormStore;
  mentor: MentorDirectoryItem;
  projects: readonly ProjectEmbed[];
  conduct: ConductPrompt;
  headingId: string;
  /** Where the form posts without JavaScript: this page, with this drawer open. */
  action: string;
  /**
   * Before the page is interactive (or without JavaScript), the drawer is a plain panel: closing it
   * is a link back to the directory. Once interactive, it is a dialog and closing is `onClose`.
   */
  closeHref?: string | null;
  onClose: () => void;
  onSent: (request: MentorRequest) => void;
}

const FIELD = cx(
  "w-full rounded-xl border border-hairline bg-ink-primary/4 px-3.5 py-3 text-[0.9375rem] leading-relaxed text-ink-primary",
  "placeholder:text-ink-muted aria-invalid:border-danger-ink", FOCUS_RING,
);
const LEGEND = "mb-2 text-[0.9375rem] font-semibold text-ink-primary";
const OPTION = cx(
  "relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-hairline px-3.5 py-2 text-sm font-semibold text-ink-primary",
  "has-checked:border-peach-ink has-checked:bg-primary/10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-peach-ink",
);

const FAILURES: Record<RequestFailure, (name: string) => string> = {
  conflict: name => `This didn't go through: you may already have a request waiting with ${name}, or their spots for this month have just filled. Your note is kept.`,
  notFound: name => `${name} isn't taking requests through the directory right now. Your note is kept.`,
  notMember: () => `${NOT_MEMBER_REASON} Your note is kept in this tab.`,
  signedOut: () => "You've been signed out. Sign in again and your note will still be here in this tab.",
  limit: () => "You already have several requests waiting, or have asked several times today. Once one is answered, or tomorrow, you can ask again. Your note is kept.",
  other: () => "Your request wasn't sent. Your note is kept; try again in a moment.",
};

/**
 * "Ask for time" (screen 05): what the person would like help with, the work
 * they attach, how, and plainly what the mentor will see. While the server
 * asks for the code of conduct first, the drawer shows that instead, with the
 * draft kept: agreeing posts this page's conduct form and comes back here.
 */
export default function RequestForm({ store, mentor, projects, conduct, headingId, action, closeHref = null, onClose, onSent }: Props) {
  const state = useRequestForm(store);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const formatRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);
  const conductRef = useRef<HTMLHeadingElement>(null);
  const ids = useId();
  const name = firstName(mentor.person.name);
  const sending = state.status === "sending";

  // The drawer opens on the note: what the person came to write.
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  // Focus follows the drawer's state: the thank-you once sent, the habits prompt when it appears.
  useEffect(() => {
    if (state.status === "sent") sentRef.current?.focus();
    if (state.status === "conduct") conductRef.current?.focus();
  }, [state.status]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = await store.submit();
    if (sent) onSent(sent);
    else if (store.getState().errors.note) noteRef.current?.focus();
    else if (store.getState().errors.format) formatRef.current?.focus();
  }

  const live = <output className="sr-only" aria-live="polite">{state.announcement}</output>;
  const header = (
    <header className="mentor-drawer__header">
      <Avatar id={mentor.person.id} name={mentor.person.name} src={mentor.person.avatarUrl ?? undefined} size="md" mentor decorative />
      <h2 id={headingId} className="min-w-0 flex-1 font-body text-xl leading-snug font-bold break-words text-ink-primary">
        Ask {name} for time
      </h2>
      {closeHref ? (
        <a href={closeHref} aria-label="Close" className={cx("grid size-8 place-items-center rounded-lg text-ink-secondary hover:bg-ink-primary/7 pointer-coarse:size-11", FOCUS_RING)}>
          <PiX aria-hidden size={18} />
        </a>
      ) : (
        <IconButton label="Close" icon={<PiX size={18} />} variant="ghost" size="sm" onClick={onClose} />
      )}
    </header>
  );
  // The live region stays put across the drawer's states, so each change is read.

  if (state.status === "sent" && state.sent) {
    return (
      <>
        {live}
        {header}
        <div className="mentor-drawer__body" data-request-sent>
          <PiCheckCircle aria-hidden className="size-8 text-peach-ink" />
          <h3 ref={sentRef} tabIndex={-1} className="text-lg font-bold text-ink-primary focus:outline-none">Request sent</h3>
          <p className="text-[0.9375rem] leading-relaxed text-ink-secondary">
            {name} will see it with their requests. While it's waiting you'll find it under Your requests on this page,
            where you can withdraw it. If {name} accepts, your private conversation opens and shows up under Needs your attention.
          </p>
          <div className="mentor-drawer__actions">
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      </>
    );
  }

  if (state.status === "conduct") {
    return (
      <>
        {live}
        {header}
        <div className="mentor-drawer__body" data-request-conduct>
          <PiShieldCheck aria-hidden className="size-8 text-ring" />
          <h3 ref={conductRef} tabIndex={-1} className="text-lg font-bold text-ink-primary focus:outline-none">First, how we talk to each other</h3>
          <p className="text-[0.9375rem] leading-relaxed text-ink-secondary">
            Your note becomes the first message of a private conversation with {name}, so it follows the same habits
            as every channel. Read them, agree once, and your request is here to send, just as you wrote it.
          </p>
          <a href={conduct.habitsHref} className={cx("w-fit text-[0.9375rem] font-semibold text-peach-ink underline underline-offset-4", FOCUS_RING)}>
            Read {CONDUCT_TITLE.toLowerCase()}
          </a>
          {conduct.canAgree ? (
            <form method="post" action={conduct.action} className="mentor-drawer__actions">
              <input type="hidden" name="intent" value={CONDUCT_INTENT} />
              <input type="hidden" name="version" value={conduct.version} />
              <Button type="submit" variant="primary">I agree</Button>
              <Button onClick={() => store.agreed()}>Back to my request</Button>
            </form>
          ) : (
            <p className="text-sm text-ink-secondary">Only the person can agree to these habits, so this session can't.</p>
          )}
        </div>
      </>
    );
  }

  const noteError = state.errors.note;
  const formatError = state.errors.format;
  const attached = state.project ? projectValue(state.project) : "";

  return (
    <>
      {live}
      {header}
      <form method="post" action={action} className="mentor-drawer__body" onSubmit={submit} noValidate aria-busy={sending || undefined}>
        <input type="hidden" name="intent" value={REQUEST_INTENT} />
        <input type="hidden" name="mentorId" value={mentor.person.id} />
        <div>
          <label htmlFor={`${ids}-note`} className={LEGEND}>What would you like help with?</label>
          <textarea
            ref={noteRef}
            id={`${ids}-note`}
            name="note"
            rows={5}
            value={state.note}
            onChange={event => store.setNote(event.target.value)}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={`${ids}-note-hint${noteError ? ` ${ids}-note-error` : ""}`}
            className={cx(FIELD, "mt-2 min-h-32 resize-y")}
            placeholder="For example: I rebuilt my fare splitter after Session 9. Could you check how I handle a payment callback that arrives twice?"
            readOnly={sending}
          />
          <p id={`${ids}-note-hint`} className="mt-1.5 text-[0.8125rem] text-ink-muted">
            Something specific helps {name} say yes. {state.note.trim().length} of {MAX_NOTE} characters.
          </p>
          {noteError && <p id={`${ids}-note-error`} className="mt-1 text-sm font-semibold text-danger-ink">{noteError}</p>}
        </div>

        <fieldset>
          <legend className={LEGEND}>Attach your work <span className="font-normal text-ink-secondary">(optional)</span></legend>
          {projects.length === 0 ? (
            <p className="text-sm text-ink-secondary">You have no published projects to attach yet. A note on its own is fine.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <label className={OPTION}>
                <input type="radio" name="project" value="" checked={attached === ""} onChange={() => store.setProject(null)} disabled={sending} className="size-4 accent-peach-ink" />
                Nothing attached
              </label>
              {projects.map(project => (
                <label key={projectValue(project)} className={OPTION}>
                  <input
                    type="radio" name="project" value={projectValue(project)}
                    checked={attached === projectValue(project)}
                    onChange={() => store.setProject(project)} disabled={sending} className="size-4 accent-peach-ink"
                  />
                  <PiFolderSimple aria-hidden className="size-[1.125rem] shrink-0 text-ink-secondary" />
                  <span className="min-w-0 break-words">{project.title} · revision {project.version}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset aria-describedby={formatError ? `${ids}-format-error` : undefined}>
          <legend className={LEGEND}>How</legend>
          <div className="flex flex-wrap gap-2">
            {mentor.formats.map((format, index) => (
              <label key={format} className={OPTION}>
                <input
                  ref={index === 0 ? formatRef : undefined}
                  type="radio" name="format" value={format} checked={state.format === format}
                  onChange={() => store.setFormat(format)} disabled={sending} className="size-4 accent-peach-ink"
                />
                {FORMAT_LABELS[format]}
              </label>
            ))}
          </div>
          {state.format && <p className="mt-2 text-[0.8125rem] text-ink-muted">{FORMAT_HINTS[state.format]}</p>}
          {formatError && <p id={`${ids}-format-error`} className="mt-1 text-sm font-semibold text-danger-ink">{formatError}</p>}
        </fieldset>

        <p className="mentor-drawer__note" data-request-privacy>
          {name} sees your name, this note and the project you attach. If {name} accepts, you both get a private
          conversation, and it shows up under Needs your attention. If the timing doesn't work, {name} can suggest
          another mentor or say not this month, and neither shows anywhere else.
        </p>

        {state.status === "error" && state.failure && (
          <p className="text-sm font-semibold text-danger-ink" data-request-error>{FAILURES[state.failure](name)}</p>
        )}

        <div className="mentor-drawer__actions">
          <Button type="submit" variant="primary" loading={sending} className="flex-1 sm:flex-none">Send request</Button>
          {closeHref ? (
            <a href={closeHref} className={cx("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold pointer-coarse:min-h-11", BUTTON_VARIANTS.quiet, FOCUS_RING)}>Cancel</a>
          ) : (
            <Button onClick={onClose}>Cancel</Button>
          )}
        </div>
      </form>
    </>
  );
}
