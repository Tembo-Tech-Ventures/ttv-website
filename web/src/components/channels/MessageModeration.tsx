import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PiCheckCircle, PiFlag, PiLockSimple } from "react-icons/pi";
import type { Message } from "@/lib/platform/contracts";
import Button from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { ChoiceGroup, TextAreaField } from "@/components/platform/ui/Field";
import Notice from "@/components/platform/ui/Notice";
import { FOCUS_RING } from "@/components/platform/ui/recipes";
import type { InPlaceModeration, ModerationActions } from "./actions";
import {
  firstName, MAX_REASON, moderationFailure, moderationNotice, REPORT_REASONS, reportReason, reviewState, type ReportReasonKey,
} from "./channel-format";

// ---- Who may do what, for the messages of one channel view ----

type ModerationContextValue = {
  /** Null while reporting is not available here (no server, or a read-only harness). */
  actions: ModerationActions | null;
  /** Whether this reader may report here: every channel, and either member of a direct conversation (QA4-01). */
  canReport: boolean;
  /**
   * A direct conversation: it has no moderators, so a report or a check goes to TTV admins, who see that
   * message alone (QA4-01), and the copy says so.
   */
  direct: boolean;
  /** The channel's capability (B-2.2): global mentors in community channels, a cohort's teachers and mentors, admins. */
  canModerate: boolean;
  /** Admins have the final say: only they restore a hidden message (B-2.5). */
  canRestore: boolean;
  /** Messages this reader reported in this visit, before the server's next copy says so too. */
  reported: ReadonlySet<string>;
  markReported: (messageId: string) => void;
};

const EMPTY: ReadonlySet<string> = new Set();
const ModerationContext = createContext<ModerationContextValue>({
  actions: null, canReport: false, direct: false, canModerate: false, canRestore: false, reported: EMPTY, markReported: () => {},
});

/**
 * Reporting and moderation for the messages below: the actions, whether this
 * reader moderates the channel, and what they did in this visit. It sits
 * above the list and the thread, so a message keeps its "Reported" when it
 * scrolls away and back, or shows in both.
 */
export function ModerationProvider({ actions, canReport, direct = false, canModerate, canRestore, children }: {
  actions: ModerationActions | null; canReport: boolean; direct?: boolean; canModerate: boolean; canRestore: boolean; children: ReactNode;
}) {
  const [reported, setReported] = useState<ReadonlySet<string>>(EMPTY);
  const value = useMemo<ModerationContextValue>(() => ({
    actions,
    canReport: canReport && actions !== null,
    direct,
    canModerate: canModerate && actions !== null,
    canRestore: canModerate && canRestore && actions !== null,
    reported,
    markReported: (id) => setReported((set) => new Set(set).add(id)),
  }), [actions, canReport, direct, canModerate, canRestore, reported]);
  return <ModerationContext.Provider value={value}>{children}</ModerationContext.Provider>;
}

export const useModeration = () => useContext(ModerationContext);

/**
 * Whether this reader has reported the message: in this visit, or before, as the server says on every
 * read (`reportedByMe`, theirs alone), so it survives a reload (QA2-06).
 */
const hasReported = (message: Message, reported: ReadonlySet<string>) => message.reportedByMe === true || reported.has(message.id);

/** What this reader may do about one message. Deleted messages take nothing; nobody reports or hides their own. */
export function moderationRights(message: Message, viewerId: string | null, context: ModerationContextValue) {
  const own = message.authorKind === "USER" && viewerId !== null && message.author.id === viewerId;
  const hidden = message.moderation?.state === "HIDDEN";
  const open = context.actions !== null && !message.deleted && viewerId !== null;
  return {
    report: open && context.canReport && !own && !hidden,
    reported: hasReported(message, context.reported),
    hide: open && context.canModerate && !own && !hidden,
    restore: open && context.canRestore && hidden,
    review: open && own && reviewState(message) === "available",
    // The server says so to the moderator who hid it only, until an admin decides (QA2-11).
    undo: open && context.canModerate && hidden && message.moderation?.undoable === true,
  };
}

// ---- The author's (or a moderator's) note on a flagged or hidden message ----

/**
 * What a flagged or hidden message says about itself, to the people the
 * server tells. The author of a hidden message can ask for a review from
 * here while the server says it is reviewable, once; after that the note says
 * it was asked, and once an admin's decision is final, that it is. The
 * moderator who hid it can take the hide back from here until an admin decides.
 * With nothing to say about moderation, it says whether this reader reported the
 * message: one note under a message, never two.
 */
export function ModerationNote({ message, viewerId, onAskReview, onUndo, undoing = false }: {
  message: Message; viewerId: string | null; onAskReview?: () => void; onUndo?: () => void; undoing?: boolean;
}) {
  const { canRestore, direct } = useModeration();
  const notice = moderationNotice(message, viewerId, { admin: canRestore, direct });
  if (!notice) return <ReportedNote message={message} />;
  // The server says so on every read, and a confirmed request updates the cached message at once.
  const review = reviewState(message);
  const actions = (review === "available" && onAskReview) || onUndo ? (
    <>
      {review === "available" && onAskReview && (
        <Button size="sm" variant="quiet" onClick={onAskReview} data-ask-review>
          Ask for review
        </Button>
      )}
      {onUndo && (
        <Button size="sm" variant="quiet" onClick={onUndo} loading={undoing} data-undo-hide>
          Undo hide
        </Button>
      )}
    </>
  ) : undefined;
  return (
    // Focusable from script only: where focus lands when a moderator's hide leaves the message with no actions.
    <div className={cx("channel-moderation mt-2 max-w-152 rounded-xl", FOCUS_RING)} data-moderation={notice.state} tabIndex={-1}>
      <Notice tone={notice.state === "HIDDEN" ? "warning" : "info"} title={`${notice.title}.`} actions={actions}>
        <p className="m-0">{notice.detail}</p>
        {review === "final" && (
          <p className="channel-moderation__asked" data-review-final>
            <PiLockSimple aria-hidden="true" className="size-4 shrink-0" />
            An admin has looked at this, and the decision is final.
          </p>
        )}
        {review === "requested" && (
          <p className={cx("channel-moderation__asked rounded-md", FOCUS_RING)} tabIndex={-1} data-review-requested>
            <PiCheckCircle aria-hidden="true" className="size-4 shrink-0" />
            Review requested. An admin will look at it again.
          </p>
        )}
      </Notice>
    </div>
  );
}

/**
 * The moderator takes their own hide back (QA2-11). No form: it only undoes what they did, and the
 * server allows it only until an admin decides. `run` is there only while this reader may, and the
 * message is being read (`reading`); `onDone` runs once the message is visible again.
 */
export function useUndoHide(
  message: Message, viewerId: string | null, reading: boolean, announce: (text: string) => void, onDone: () => void,
): { run: (() => void) | undefined; pending: boolean } {
  const context = useModeration();
  const [pending, setPending] = useState(false);
  async function undo() {
    if (!context.actions || pending) return;
    setPending(true);
    try {
      await context.actions.undoHide(message.id);
      announce("Hide undone. Members can see the message again.");
      onDone();
    } catch (failure) {
      announce(moderationFailure(failure, "moderate"));
    } finally {
      setPending(false);
    }
  }
  const allowed = reading && moderationRights(message, viewerId, context).undo;
  return { run: allowed ? () => void undo() : undefined, pending };
}

/** Who looks at a report: a direct conversation has no moderators, so TTV admins do. */
const reportReader = (direct: boolean) => (direct ? "A TTV admin" : "A moderator");

/** Under a message this reader reported. The live region said it once, when they did. */
export function ReportedNote({ message }: { message: Message }) {
  const { reported, direct } = useModeration();
  if (!hasReported(message, reported)) return null;
  return (
    <p className="channel-reported" data-reported>
      <PiFlag aria-hidden="true" className="size-3.5 shrink-0" />
      You reported this. {reportReader(direct)} will look at it.
    </p>
  );
}

// ---- The forms: report, hide or restore, ask for review ----

type PanelProps = {
  message: Message;
  /** Done: the change was accepted. Focus goes back to the message's actions. */
  onDone: () => void;
  onCancel: () => void;
  announce: (text: string) => void;
};

/**
 * One in-place form under a message: a title, its fields, an error if the server refused, and two buttons.
 * The submit button is never disabled (a disabled one looks like it does nothing, QA2-10): each form
 * checks its own fields on submit and says beside the field what is missing.
 */
function Panel({ title, children, error, submitLabel, submitting, danger = false, onSubmit, onCancel, kind }: {
  title: string; children: ReactNode; error: string | null; submitLabel: string; submitting: boolean;
  danger?: boolean; onSubmit: () => void; onCancel: () => void; kind: string;
}) {
  const titleId = useId();
  const form = useRef<HTMLFormElement>(null);
  const buttons = useRef<HTMLDivElement>(null);

  // Escape backs out from anywhere in the form, as it does from an edit.
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      cancel.current();
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, []);

  // The whole form in view, with its buttons. A form taller than the list it scrolls in (touch-sized
  // controls on a short phone) shows its start instead, where focus is: its title and first field.
  const showButtons = useCallback(() => {
    form.current?.scrollIntoView({ block: "nearest" });
    buttons.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const reveal = useCallback(() => {
    const element = form.current;
    if (element && tallerThanItsList(element)) element.scrollIntoView({ block: "start" });
    else showButtons();
  }, [showButtons]);

  // Start where the person decides, the first field.
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    element.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
    reveal();
    // Measured again once it has unfolded: during the opening it is a little shorter than at rest.
    // Its own animation only: a field's would otherwise scroll a tall form back past its buttons.
    const unfolded = (event: AnimationEvent) => {
      if (event.target !== element) return;
      element.removeEventListener("animationend", unfolded);
      reveal();
    };
    element.addEventListener("animationend", unfolded);
    return () => element.removeEventListener("animationend", unfolded);
  }, [reveal]);

  // A refusal adds its reason above the buttons and pushes them down: bring them back.
  useEffect(() => {
    if (error) showButtons();
  }, [error, showButtons]);

  return (
    <form
      ref={form}
      aria-labelledby={titleId}
      className="channel-panel"
      data-panel={kind}
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!submitting) onSubmit();
      }}
    >
      <p id={titleId} className="channel-panel__title">
        {title}
      </p>
      {children}
      {error && <Notice tone="danger" announce="assertive" title={error} />}
      <div ref={buttons} className="channel-panel__actions flex flex-wrap items-center gap-2">
        {/* Quiet, or danger for a hide: the view's one peach action stays the composer's Send. */}
        <Button type="submit" size="sm" variant={danger ? "danger" : "quiet"} loading={submitting}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Whether the form, with its scroll margins, cannot fit in the nearest box that scrolls it (or the window). */
function tallerThanItsList(element: HTMLElement): boolean {
  let scroller = element.parentElement;
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  const visible = scroller?.clientHeight ?? window.innerHeight;
  const { scrollMarginTop, scrollMarginBottom } = getComputedStyle(element);
  return element.offsetHeight + parseFloat(scrollMarginTop) + parseFloat(scrollMarginBottom) > visible;
}

/**
 * A labelled box for a reason or a note, with the server's limit. A required box drops "(optional)" and
 * says so to assistive tech; `missing` is what to write when it was left empty, shown under the box once
 * the person tried to send (the form has `noValidate`, so this is the only message).
 */
function ReasonBox({ id, label, hint, value, onChange, required = false, missing = null }: {
  id: string; label: string; hint?: string; value: string; onChange: (value: string) => void; required?: boolean;
  missing?: string | null;
}) {
  return (
    <TextAreaField
      id={id}
      label={label}
      hint={hint}
      optional={!required}
      required={required}
      aria-required={required || undefined}
      error={missing ?? undefined}
      value={value}
      rows={2}
      maxLength={MAX_REASON}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** A field left empty: what to say under it once the person tries to send, and where to put them back. */
function useMissing() {
  const [tried, setTried] = useState(false);
  const id = useId();
  return {
    tried,
    id,
    /** Call on submit with whether the field is filled; false focuses it and shows the message. */
    check(filled: boolean): boolean {
      setTried(!filled);
      if (!filled) document.getElementById(id)?.focus();
      return filled;
    },
  };
}

/** Report a message to the moderators: why, in a few choices, and anything they should know. */
export function ReportForm({ message, onDone, onCancel, announce }: PanelProps) {
  const { actions, markReported, direct } = useModeration();
  const [choice, setChoice] = useState<ReportReasonKey | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();
  const [choiceMissing, setChoiceMissing] = useState(false);
  const words = useMissing();
  const reason = choice === null ? null : reportReason(choice, details);

  async function submit() {
    if (!actions) return;
    if (choice === null) {
      setChoiceMissing(true);
      document.getElementById(`${name}-${REPORT_REASONS[0].key}`)?.focus();
      return;
    }
    if (!words.check(reason !== null) || reason === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.report(message.id, reason);
      markReported(message.id);
      announce(`Reported. ${reportReader(direct)} will look at it.`);
      onDone();
    } catch (failure) {
      setError(moderationFailure(failure, "report"));
      setSubmitting(false);
    }
  }

  const tembo = message.authorKind === "TEMBO";
  const whose = tembo ? "Tembo's answer" : `${firstName(message.author.name)}'s message`;
  return (
    <Panel
      kind="report"
      title={`Report ${whose}`}
      error={error}
      submitLabel="Send report"
      submitting={submitting}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      {/* The kit's radios, unchanged in the DOM; the form reads the choice as it changes. */}
      <div
        onChange={(event) => {
          const target = event.target as HTMLInputElement;
          if (target.name !== name) return;
          setChoice(target.value as ReportReasonKey);
          setChoiceMissing(false);
        }}
      >
        <ChoiceGroup
          name={name}
          label="What's wrong with it?"
          options={REPORT_REASONS.map((option) => ({ value: option.key, label: option.label }))}
          error={choiceMissing ? "Choose what's wrong with it first." : undefined}
          required
        />
      </div>
      <ReasonBox
        id={words.id}
        label={choice === "other" ? `Tell ${direct ? "TTV admins" : "the moderators"} what's wrong` : "Add details"}
        value={details}
        onChange={setDetails}
        required={choice === "other"}
        missing={words.tried && choice === "other" && !details.trim() ? "Write what's wrong first." : null}
      />
      {direct ? (
        // True of the server: an admin outside the conversation reads the reported message alone (QA4-01).
        // Who reported it goes unsaid: with two people in it, that would be no promise.
        <p className="text-[0.8125rem] text-ink-secondary" data-report-direct>
          TTV admins will see this message, and only this message. It stays up while they look at it.
        </p>
      ) : (
        <p className="text-[0.8125rem] text-ink-secondary">
          The message stays up while a moderator looks at it.
          {/* True of the server: a report changes nothing the author can see (reportMessage, B-2.5). */}
          {!tembo && ` ${firstName(message.author.name)} won't see who reported it.`}
        </p>
      )}
    </Panel>
  );
}

const MODERATE_COPY: Record<InPlaceModeration, { title: string; label: string; submit: string; done: string; missing: string }> = {
  hide: {
    title: "Hide this message from members", label: "Why are you hiding it?", submit: "Hide message", done: "Message hidden from members.",
    missing: "Write why you're hiding it first. The record keeps your reason.",
  },
  restore: {
    title: "Show this message to members again", label: "Why can it come back?", submit: "Restore message", done: "Message restored. Members can see it again.",
    missing: "Write why it can come back first. The record keeps your reason.",
  },
};

/**
 * What happens next, said before the moderator decides. A hidden message stays
 * readable to its author, with the reason; an admin looks at every hide by a
 * channel moderator and alone can restore it.
 */
export function moderateHint(message: Message, action: InPlaceModeration, admin: boolean): string {
  if (action === "restore") return "Everyone in this channel will see it again.";
  if (message.authorKind === "TEMBO") return admin ? "Moderators will still see it, with your reason. You can restore it later." : "Moderators will still see it, with your reason. An admin looks at every hide and can restore it.";
  const author = firstName(message.author.name);
  return admin
    ? `${author} will still see it, with your reason. You can restore it later.`
    : `${author} will still see it, with your reason, and can ask for a review. An admin looks at every hide and can restore it.`;
}

/** A moderator hides a message, or an admin restores one, with a reason the record keeps. */
export function ModerateForm({ message, action, onDone, onCancel, announce }: PanelProps & { action: InPlaceModeration }) {
  const { actions, canRestore } = useModeration();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = useMissing();
  const copy = MODERATE_COPY[action];
  const hint = moderateHint(message, action, canRestore);

  async function submit() {
    if (!actions || !missing.check(reason.trim().length > 0)) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.moderate(message.id, action, reason.trim());
      // A moderator who is not an admin hears what happens next, as the note on the message now says (QA2-11).
      announce(action === "hide" && !canRestore ? `${copy.done} An admin will look at it.` : copy.done);
      onDone();
    } catch (failure) {
      setError(moderationFailure(failure, "moderate"));
      setSubmitting(false);
    }
  }

  return (
    <Panel
      kind={action}
      title={copy.title}
      error={error}
      submitLabel={copy.submit}
      submitting={submitting}
      danger={action === "hide"}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <ReasonBox
        id={missing.id}
        label={copy.label}
        hint={hint}
        value={reason}
        onChange={setReason}
        required
        missing={missing.tried && !reason.trim() ? copy.missing : null}
      />
    </Panel>
  );
}

/** The author asks an admin to look again at their hidden message. */
export function ReviewForm({ message, onDone, onCancel, announce }: PanelProps) {
  const { actions } = useModeration();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!actions) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.requestReview(message.id, note.trim() || null);
      announce("Review requested. An admin will look at it again.");
      onDone();
    } catch (failure) {
      setError(moderationFailure(failure, "review"));
      setSubmitting(false);
    }
  }

  return (
    <Panel
      kind="review"
      title="Ask for a review"
      error={error}
      submitLabel="Ask for review"
      submitting={submitting}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <ReasonBox id={noteId} label="Anything the reviewer should know" value={note} onChange={setNote} />
    </Panel>
  );
}

export type ModerationMode = "report" | InPlaceModeration | "review";
/** Where focus goes when a form closes: the message's actions, or the review note's parts. */
export type ReturnFocus = "menu" | "[data-review-requested]" | "[data-ask-review]";

/** The open moderation form under a message, if any. */
export function ModerationPanel({ mode, message, announce, onBack }: {
  mode: string; message: Message; announce: (text: string) => void; onBack: (focus?: ReturnFocus) => void;
}) {
  const close = () => onBack();
  switch (mode) {
    case "report":
      return <ReportForm message={message} onDone={close} onCancel={close} announce={announce} />;
    case "hide":
    case "restore":
      return <ModerateForm message={message} action={mode} onDone={close} onCancel={close} announce={announce} />;
    case "review":
      return <ReviewForm message={message} onDone={() => onBack("[data-review-requested]")} onCancel={() => onBack("[data-ask-review]")} announce={announce} />;
    default:
      return null;
  }
}
