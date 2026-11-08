import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { PiCheckCircle, PiShieldCheck, PiX } from "react-icons/pi";
import type { MentorDirectoryItem, MentorRequest, ProjectEmbed } from "@/lib/platform/contracts";
import { useRequestForm } from "@/lib/platform/client/hooks/mentoring";
import { MAX_NOTE, type RequestFailure, type RequestFormState, type RequestFormStore } from "@/lib/platform/client/mentor-request-form";
import { firstName } from "@/components/channels/channel-format";
import { CONDUCT_TITLE } from "@/components/channels/conduct";
import {
  Avatar, Button, ButtonLink, ChoiceGroup, FOCUS_RING, IconButton, Notice, TextAreaField, buttonClass, cx,
} from "@/components/platform/ui";
import { LABEL } from "@/components/platform/ui/recipes";
import { agreeToConduct } from "./agree-conduct";
import { FORMAT_HINTS, FORMAT_LABELS } from "./mentor-display";
import { AGREE_FIELD, projectValue, REQUEST_INTENT } from "./request-fields";

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
 * Keeps the drawer's scroller clear of its pinned header and footer: their heights, measured as they
 * change (the footer grows with the habits and a failure), become the sheet's scroll padding, so a
 * control that takes focus scrolls into the space between them, never under either (WCAG 2.4.11).
 */
function useStickyClearance(form: RefObject<HTMLFormElement>, view: string) {
  useEffect(() => {
    const sheet = form.current?.closest<HTMLElement>(".mentor-drawer__sheet");
    const header = sheet?.querySelector<HTMLElement>(".mentor-drawer__header");
    const footer = form.current?.querySelector<HTMLElement>(".mentor-drawer__actions--sticky");
    if (!sheet || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      sheet.style.setProperty("--drawer-head", `${header?.offsetHeight ?? 0}px`);
      sheet.style.setProperty("--drawer-foot", `${footer?.offsetHeight ?? 0}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const edge of [header, footer]) if (edge) observer.observe(edge);
    return () => {
      observer.disconnect();
      // The habits step and the thank-you have no pinned footer to clear.
      sheet.style.removeProperty("--drawer-foot");
    };
    // Measured again whenever the drawer changes what it shows: the form is replaced by a step and comes back.
  }, [form, view]);
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
  const sentRef = useRef<HTMLHeadingElement>(null);
  const conductRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useStickyClearance(formRef, state.status);
  const ids = useId();
  const noteId = `${ids}-note`;
  const refusedId = `${ids}-refused`;
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
  // Opened refused: the page came back with this drawer after a send without JavaScript that did not go through.
  const [refusedOnArrival] = useState(() => refused(store.getState()));

  // The drawer opens on the note, what the person came to write; or, sent back refused, on why.
  useEffect(() => {
    document.getElementById(refusedOnArrival ? refusedId : noteId)?.focus();
  }, []); // oxlint-disable-line react-hooks/exhaustive-deps

  // Focus follows the drawer's state: the thank-you once sent, the habits prompt when it appears.
  const lastStatus = useRef(state.status);
  useEffect(() => {
    if (state.status === "sent") sentRef.current?.focus();
    if (state.status === "conduct") conductRef.current?.focus();
    // On a short screen the footer scrolls with the form, so the reason that just appeared above Send can push
    // it past the sheet's edge: bring it back, with the reason. Pinned, both are in view already (T13). Only
    // after a send from this drawer: one the page arrived with keeps the note it focuses in view.
    if (state.status === "error" && lastStatus.current === "sending") {
      const send = formRef.current?.querySelector<HTMLElement>("[data-request-send]");
      // Agreeing from the habits step unmounts the button that had focus: Send takes it back, for the retry.
      if (!formRef.current?.contains(document.activeElement)) send?.focus({ preventScroll: true });
      send?.scrollIntoView({ block: "nearest" });
    }
    lastStatus.current = state.status;
  }, [state.status]);

  const attached = state.project ? projectValue(state.project) : "";
  // The radios keep their own checked state; a draft restored from the tab after they rendered moves it.
  useEffect(() => {
    for (const input of formRef.current?.querySelectorAll<HTMLInputElement>("input[type=radio]") ?? []) {
      const chosen = input.name === "format" ? state.format : input.name === "project" ? attached : undefined;
      if (chosen !== undefined) input.checked = input.value === chosen;
    }
  }, [state.format, attached, state.status]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const step = state.status === "conduct";
    const agreement = agreementFor(conduct, !agreed || step);
    setFromStep(step);
    const sent = await store.submit(agreement.options);
    setFromStep(false);
    if (agreement.recorded()) agreedNow();
    if (sent) onSent(sent);
    else if (store.getState().errors.note) document.getElementById(noteId)?.focus();
    else if (store.getState().errors.format) formRef.current?.querySelector<HTMLInputElement>("input[name=format]")?.focus();
  }

  // A radio's choice, for the draft: the radios are the kit's own, which keep their checked state.
  function chose(event: FormEvent<HTMLFormElement>) {
    const input = event.target as HTMLInputElement;
    if (input.type !== "radio") return;
    const format = mentor.formats.find(offered => offered === input.value);
    if (input.name === "format" && format) store.setFormat(format);
    if (input.name === "project") store.setProject(projects.find(project => projectValue(project) === input.value) ?? null);
  }

  // A failed send is read out by its alert, beside Send, so the live region doesn't say it a second time.
  const live = <output className="sr-only" aria-live="polite">{state.status === "error" ? "" : state.announcement}</output>;
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
          form={{ action, onSubmit: submit, mentorId: mentor.person.id, note: state.note, project: attached, format: state.format }}
        />
      </>
    );
  }

  const noteError = state.errors.note;
  const formatError = state.errors.format;

  return (
    <>
      {live}
      {header}
      <form
        ref={formRef} method="post" action={action} className="mentor-drawer__body" onSubmit={submit} onChange={chose}
        noValidate aria-busy={sending || undefined}
      >
        <input type="hidden" name="intent" value={REQUEST_INTENT} />
        <input type="hidden" name="mentorId" value={mentor.person.id} />
        <TextAreaField
          id={noteId}
          name="note"
          label="What would you like help with?"
          hint={`Something specific helps ${name} say yes. ${state.note.trim().length} of ${MAX_NOTE} characters.`}
          error={noteError}
          rows={5}
          value={state.note}
          onChange={event => store.setNote(event.target.value)}
          placeholder="For example: I rebuilt my fare splitter after Session 9. Could you check how I handle a payment callback that arrives twice?"
          readOnly={sending}
        />

        <AttachWork projects={projects} attached={attached} sending={sending} />

        <ChoiceGroup
          name="format"
          label="How"
          error={formatError}
          defaultValue={state.format ?? undefined}
          options={mentor.formats.map(format => ({ value: format, label: FORMAT_LABELS[format], hint: FORMAT_HINTS[format], disabled: sending }))}
        />

        {/* Who sees what, in a line; the rest behind "How this works", so Send stays in view at 1440×900 (T05). */}
        <div className="mentor-drawer__note" data-request-privacy>
          <p>{name} sees your name, this note and the project you attach.</p>
          <details className="mentor-drawer__more">
            <summary className={buttonClass({ variant: "ghost", size: "sm", className: "mentor-drawer__more-toggle cursor-pointer" })}>How this works</summary>
            <p className="mt-2">
              Some requests get a check from TTV before they reach a mentor. If {name} accepts, you both get a private
              conversation, and it shows up under Needs your attention. If the timing doesn't work, {name} can suggest
              another mentor or say not this month, and neither shows anywhere else.
            </p>
          </details>
        </div>

        {/*
          The habits, and why the last send didn't go, sit just above Send, inside the pinned footer, so they
          are in view whenever it is (QA4-05, T05, T13).
        */}
        <SendActions
          agreement={asksAgreement ? <ConductBeforeSend name={name} conduct={conduct} headingId={`${ids}-conduct`} /> : null}
          failure={(
            <SendRefused
              id={refusedId} focusOnLoad={refusedOnArrival} name={name}
              failure={state.status === "error" ? state.failure : null} message={state.failureMessage} fields={Boolean(noteError || formatError)}
            />
          )}
          sending={sending} closeHref={closeHref} onClose={onClose}
        />
      </form>
    </>
  );
}

/** Whether the form stands refused: the last send failed, or left something to fix. */
function refused(state: Pick<RequestFormState, "status" | "errors">): boolean {
  return state.status === "error" || Object.keys(state.errors).length > 0;
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
      <h3 ref={headingRef} tabIndex={-1} className={cx("w-fit rounded-sm text-lg font-bold text-ink-primary", FOCUS_RING)}>Request sent</h3>
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

/** The habits, just above Send, for someone who has not agreed to them yet: the form then carries the agreement. */
function ConductBeforeSend({ name, conduct, headingId }: { name: string; conduct: ConductPrompt; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="flex w-full flex-col gap-1.5 text-[0.8125rem] leading-snug text-ink-secondary" data-request-conduct-inline>
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
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
      <h3 ref={headingRef} tabIndex={-1} className={cx("w-fit rounded-sm text-lg font-bold text-ink-primary", FOCUS_RING)}>First, how we talk to each other</h3>
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
      <h2 id={headingId} className="min-w-0 flex-1 text-xl leading-snug break-words text-ink-primary">
        Ask {name} for time
      </h2>
      {closeHref ? (
        // IconButton cannot be a link: the same ghost square, from the button recipe.
        <ButtonLink href={closeHref} aria-label="Close" variant="ghost" size="sm" className="mentor-drawer__close" icon={<PiX size={18} />} />
      ) : (
        <IconButton label="Close" icon={<PiX size={18} />} variant="ghost" size="sm" onClick={onClose} />
      )}
    </header>
  );
}

/**
 * Send and Cancel, pinned to the drawer's bottom edge (T05). While sending also agrees to the habits,
 * they come first in the footer (`agreement`), so what Send agrees to is always in view beside it. Why
 * the last send didn't go comes straight above Send, where the person pressing it is looking (T13).
 */
function SendActions({ agreement, failure, sending, closeHref, onClose }: {
  agreement: ReactNode; failure: ReactNode; sending: boolean; closeHref: string | null; onClose: () => void;
}) {
  return (
    <div className="mentor-drawer__actions mentor-drawer__actions--sticky">
      {agreement}
      {failure}
      <Button type="submit" variant="primary" loading={sending} className="flex-1 sm:flex-none" data-request-send>
        {agreement ? "Agree and send request" : "Send request"}
      </Button>
      <CancelControl closeHref={closeHref} onClose={onClose} />
    </div>
  );
}

/** Before the page is interactive (or without JavaScript), Cancel is a link back to the directory. */
function CancelControl({ closeHref, onClose }: { closeHref: string | null; onClose: () => void }) {
  return closeHref ? (
    <ButtonLink href={closeHref} variant="ghost">Cancel</ButtonLink>
  ) : (
    <Button variant="ghost" onClick={onClose}>Cancel</Button>
  );
}

/** One of the person's own published projects, at its current revision, or nothing. */
function AttachWork({ projects, attached, sending }: { projects: readonly ProjectEmbed[]; attached: string; sending: boolean }) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col gap-1.5" data-request-no-projects>
        <p className={cx(LABEL, "m-0")}>Attach your work</p>
        <p className="m-0 text-sm text-ink-secondary">You have no published projects to attach yet. A note on its own is fine.</p>
      </div>
    );
  }
  return (
    <ChoiceGroup
      name="project"
      label="Attach your work"
      optional
      defaultValue={attached}
      options={[
        { value: "", label: "Nothing attached", disabled: sending },
        ...projects.map(project => ({ value: projectValue(project), label: `${project.title} · revision ${project.version}`, disabled: sending })),
      ]}
    />
  );
}

/**
 * Why the last send didn't go, when it didn't: a danger notice just above Send, where the person pressing it
 * is looking (T13). A failure is an alert, so it is read out as it appears, and again after a retry that fails
 * too: sending clears it first. Fields to fix are said under each field, which takes focus; this only says
 * the request wasn't sent. After a send without JavaScript the page comes back with the drawer, and the
 * notice takes focus, so the reason is where the reader lands.
 */
function SendRefused({ id, failure, message, name, fields, focusOnLoad }: {
  id: string; failure: RequestFailure | null; message: string | null; name: string; fields: boolean; focusOnLoad: boolean;
}) {
  if (!failure && !fields) return null;
  return (
    <div className="w-full" data-request-error>
      <Notice id={id} tone="danger" tabIndex={-1} focusOnLoad={focusOnLoad} {...failure ? {} : { announce: "none" as const }}>
        {failure ? failureText(failure, message, name) : "Your request wasn't sent. Fix what's marked above, then send it again."}
      </Notice>
    </div>
  );
}
