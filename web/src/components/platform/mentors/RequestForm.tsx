import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { PiCheckCircle, PiFolderSimple, PiShieldCheck, PiX } from "react-icons/pi";
import type { MentorDirectoryItem, MentorRequest, ProjectEmbed } from "@/lib/platform/contracts";
import { useRequestForm } from "@/lib/platform/client/hooks/mentoring";
import { MAX_NOTE, type RequestFailure, type RequestFormStore } from "@/lib/platform/client/mentor-request-form";
import { firstName } from "@/components/channels/channel-format";
import { CONDUCT_TITLE } from "@/components/channels/conduct";
import { Avatar, Button, IconButton } from "@/components/platform/ui";
import { BUTTON_VARIANTS, FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { agreeToConduct } from "./agree-conduct";
import { FORMAT_HINTS, FORMAT_LABELS } from "./mentor-display";
import { AGREE_FIELD, projectValue, REQUEST_INTENT } from "./request-post";

/** Where agreeing to the habits posts (this page, drawer open) and where to read them first. */
export interface ConductPrompt {
  action: string;
  version: number;
  habitsHref: string;
  /** False for an agent's delegated session, which may never agree for the person. */
  canAgree: boolean;
  /**
   * The person has agreed to the words as they are now, as the page read it. When not, the drawer shows the
   * habits before Send, and sending agrees to them (QA4-05).
   */
  agreed: boolean;
  /** Records the agreement with JavaScript; the DEV harness's stands in for the page's own post. */
  agree?: () => Promise<void>;
}

interface Props {
  store: RequestFormStore;
  mentor: MentorDirectoryItem;
  projects: readonly ProjectEmbed[];
  conduct: ConductPrompt;
  headingId: string;
  /** Where the form posts without JavaScript: this page, with this drawer open. */
  action: string;
  /** Told once a send here recorded the agreement, so the next drawer opened on this page does not ask again. */
  onAgreed?: () => void;
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

/**
 * Why a send didn't go. A conflict or a limit says the server's own sentence when it gave one (which request is
 * in the way, or when the next spot opens: QA4-11); these words are for when it did not.
 */
const FAILURES: Record<RequestFailure, (name: string) => string> = {
  conflict: name => `This didn't go through: you may already have a request with ${name}, or their spots for this month have just filled.`,
  notFound: name => `${name} isn't taking requests through the directory right now.`,
  signedOut: () => "You've been signed out. Sign in again and your note will still be here in this tab.",
  limit: () => "You already have several requests waiting, or have asked several times today. Once one is answered, or tomorrow, you can ask again.",
  agree: () => "Your agreement wasn't saved, so your request wasn't sent. Try again in a moment.",
  other: () => "Your request wasn't sent. Try again in a moment.",
};
const KEPT = new Set<RequestFailure>(["conflict", "notFound", "limit", "agree", "other"]);

/** The drawer's sentence for a failed send: the server's words or the fixed ones, and that the note is kept. */
export function failureText(failure: RequestFailure, message: string | null, name: string): string {
  const reason = message ?? FAILURES[failure](name);
  return KEPT.has(failure) ? `${reason} Your note is kept.` : reason;
}

/**
 * "Ask for time" (screen 05): what the person would like help with, the work
 * they attach, how, and plainly what the mentor will see. Someone who has not
 * agreed to how we talk to each other yet reads that before Send, and sending
 * agrees to it and sends in one press. If the server still asks for the habits
 * first (the words changed since the page was read), the drawer shows them
 * with the draft kept, and agreeing there sends too.
 */
export default function RequestForm({
  store, mentor, projects, conduct, headingId, action, closeHref = null, onClose, onSent, onAgreed,
}: Props) {
  const state = useRequestForm(store);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const formatRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);
  const conductRef = useRef<HTMLHeadingElement>(null);
  const ids = useId();
  const name = firstName(mentor.person.name);
  const sending = state.status === "sending";
  // Agreed as the page knows it (read at load, or in an earlier drawer: each drawer mounts afresh), or here
  // since: a later send (after a refusal) does not agree again.
  const [agreed, setAgreed] = useState(conduct.agreed);
  const agreedNow = () => {
    setAgreed(true);
    onAgreed?.();
  };
  const asksAgreement = !agreed && conduct.canAgree;
  // Agreeing from the habits step keeps that step in view while the request goes.
  const [fromStep, setFromStep] = useState(false);

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
    const step = state.status === "conduct";
    const agreement = agreementFor(conduct, !agreed || step);
    setFromStep(step);
    const sent = await store.submit(agreement.options);
    setFromStep(false);
    if (agreement.recorded()) agreedNow();
    if (sent) onSent(sent);
    else if (store.getState().errors.note) noteRef.current?.focus();
    else if (store.getState().errors.format) formatRef.current?.focus();
  }

  const live = <output className="sr-only" aria-live="polite">{state.announcement}</output>;
  const header = <DrawerHeader mentor={mentor} name={name} headingId={headingId} closeHref={closeHref} onClose={onClose} />;

  // The live region stays put across the drawer's states, so each change is read.

  if (state.status === "sent" && state.sent) {
    return <>{live}{header}<SentPanel name={name} headingRef={sentRef} onClose={onClose} /></>;
  }

  if (state.status === "conduct" || (sending && fromStep)) {
    return (
      <>
        {live}
        {header}
        <ConductStep
          name={name} conduct={conduct} headingRef={conductRef} sending={sending} onBack={() => store.agreed()}
          form={{ action, onSubmit: submit, mentorId: mentor.person.id, note: state.note, project: state.project ? projectValue(state.project) : "", format: state.format }}
        />
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

        <AttachWork projects={projects} attached={attached} sending={sending} store={store} />

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
          {name} sees your name, this note and the project you attach. Some requests get a check from TTV before they
          reach a mentor. If {name} accepts, you both get a private conversation, and it shows up under Needs your
          attention. If the timing doesn't work, {name} can suggest another mentor or say not this month, and neither
          shows anywhere else.
        </p>

        {/* Before Send, not after it (QA4-05): the note follows the channels' habits, and sending agrees to them. */}
        {asksAgreement && <ConductBeforeSend name={name} conduct={conduct} headingId={`${ids}-conduct`} />}

        <SendFailure failure={state.status === "error" ? state.failure : null} message={state.failureMessage} name={name} />

        <div className="mentor-drawer__actions">
          <Button type="submit" variant="primary" loading={sending} className="flex-1 sm:flex-none">
            {asksAgreement ? "Agree and send request" : "Send request"}
          </Button>
          <CancelControl closeHref={closeHref} onClose={onClose} />
        </div>
      </form>
    </>
  );
}

/** The draft as hidden fields, for the habits step's form, which sends it without JavaScript. */
function DraftFields({ mentorId, note, project, format }: { mentorId: string; note: string; project: string; format: string | null }) {
  return (
    <>
      <input type="hidden" name="intent" value={REQUEST_INTENT} />
      <input type="hidden" name="mentorId" value={mentorId} />
      <input type="hidden" name="note" value={note} />
      <input type="hidden" name="project" value={project} />
      {format && <input type="hidden" name="format" value={format} />}
    </>
  );
}

/** The thank-you once the server has the request, and what happens next. */
function SentPanel({ name, headingRef, onClose }: { name: string; headingRef: RefObject<HTMLHeadingElement>; onClose: () => void }) {
  return (
    <div className="mentor-drawer__body" data-request-sent>
      <PiCheckCircle aria-hidden className="size-8 text-peach-ink" />
      <h3 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink-primary focus:outline-none">Request sent</h3>
      <p className="text-[0.9375rem] leading-relaxed text-ink-secondary">
        While it's waiting you'll find it under Your requests on this page, where you can withdraw it. Some requests
        get a check from TTV before they reach a mentor; if yours does, Your requests says so, and you'll get a
        notice when it's done. If {name} accepts, your private conversation opens and shows up under Needs your attention.
      </p>
      <div className="mentor-drawer__actions">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

/** The habits, above Send, for someone who has not agreed to them yet: the form then carries the agreement. */
function ConductBeforeSend({ name, conduct, headingId }: { name: string; conduct: ConductPrompt; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="mentor-drawer__note flex flex-col gap-2" data-request-conduct-inline>
      <h3 id={headingId} className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink-primary">
        <PiShieldCheck aria-hidden className="size-5 shrink-0 text-ring" />
        Before you send: {CONDUCT_TITLE.toLowerCase()}
      </h3>
      <p>
        Your note becomes the first message of a private conversation with {name}, so it follows the same habits
        as every channel. Sending this request agrees to them, once.
      </p>
      <a href={conduct.habitsHref} className={cx("w-fit font-semibold text-peach-ink underline underline-offset-4", FOCUS_RING)}>
        Read {CONDUCT_TITLE.toLowerCase()}
      </a>
      <input type="hidden" name={AGREE_FIELD} value={conduct.version} />
    </section>
  );
}

/**
 * The server still asked for the habits (the words changed since the page was read). Agreeing sends: the
 * draft rides along as hidden fields, so without JavaScript it sends in the same post.
 */
function ConductStep({ name, conduct, headingRef, sending, onBack, form }: {
  name: string; conduct: ConductPrompt; headingRef: RefObject<HTMLHeadingElement>; sending: boolean; onBack: () => void;
  form: { action: string; onSubmit: (event: FormEvent) => void; mentorId: string; note: string; project: string; format: string | null };
}) {
  return (
    <div className="mentor-drawer__body" data-request-conduct>
      <PiShieldCheck aria-hidden className="size-8 text-ring" />
      <h3 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink-primary focus:outline-none">First, how we talk to each other</h3>
      <p className="text-[0.9375rem] leading-relaxed text-ink-secondary">
        Your request isn't sent yet. Your note becomes the first message of a private conversation with {name},
        so it follows the same habits as every channel. Read them, and agreeing sends your request, just as you wrote it.
      </p>
      <a href={conduct.habitsHref} className={cx("w-fit text-[0.9375rem] font-semibold text-peach-ink underline underline-offset-4", FOCUS_RING)}>
        Read {CONDUCT_TITLE.toLowerCase()}
      </a>
      {conduct.canAgree ? (
        <form method="post" action={form.action} className="mentor-drawer__actions" onSubmit={form.onSubmit} aria-busy={sending || undefined}>
          <DraftFields mentorId={form.mentorId} note={form.note} project={form.project} format={form.format} />
          <input type="hidden" name={AGREE_FIELD} value={conduct.version} />
          <Button type="submit" variant="primary" loading={sending}>I agree, send my request</Button>
          <Button onClick={onBack} disabled={sending}>Back to my request</Button>
        </form>
      ) : (
        <p className="text-sm text-ink-secondary">Only the person can agree to these habits, so this session can't.</p>
      )}
    </div>
  );
}

/**
 * How a send agrees, when it does: the harness's own, or the page's conduct post. `recorded` says afterwards
 * whether the agreement went through, so a later send (after a refusal) does not agree again.
 */
function agreementFor(conduct: ConductPrompt, needed: boolean) {
  let recorded = false;
  const record = conduct.agree ?? (() => agreeToConduct(conduct.action, conduct.version));
  const agree = async () => { await record(); recorded = true; };
  return { options: conduct.canAgree && needed ? { agree } : {}, recorded: () => recorded };
}

function DrawerHeader({ mentor, name, headingId, closeHref, onClose }: {
  mentor: MentorDirectoryItem; name: string; headingId: string; closeHref: string | null; onClose: () => void;
}) {
  return (
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
}

/** Before the page is interactive (or without JavaScript), Cancel is a link back to the directory. */
function CancelControl({ closeHref, onClose }: { closeHref: string | null; onClose: () => void }) {
  return closeHref ? (
    <a href={closeHref} className={cx("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold pointer-coarse:min-h-11", BUTTON_VARIANTS.quiet, FOCUS_RING)}>Cancel</a>
  ) : (
    <Button onClick={onClose}>Cancel</Button>
  );
}

/** One of the person's own published projects, at its current revision, or nothing. */
function AttachWork({ projects, attached, sending, store }: {
  projects: readonly ProjectEmbed[]; attached: string; sending: boolean; store: RequestFormStore;
}) {
  return (
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
  );
}

/** Why the last send didn't go, when it didn't. */
function SendFailure({ failure, message, name }: { failure: RequestFailure | null; message: string | null; name: string }) {
  return failure && <p className="text-sm font-semibold text-danger-ink" data-request-error>{failureText(failure, message, name)}</p>;
}
