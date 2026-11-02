import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PiCheckCircle, PiEyeSlash, PiFlag } from "react-icons/pi";
import type { Message } from "@/lib/platform/contracts";
import Button from "@/components/platform/ui/Button";
import type { InPlaceModeration, ModerationActions } from "./actions";
import {
  firstName, MAX_REASON, moderationFailure, moderationNotice, REPORT_REASONS, reportReason, type ReportReasonKey,
} from "./channel-format";

// ---- Who may do what, for the messages of one channel view ----

type ModerationContextValue = {
  /** Null while reporting is not available here (no server, or a read-only harness). */
  actions: ModerationActions | null;
  /** Reports exist in cohort and community channels, not direct conversations yet (B-2.5). */
  canReport: boolean;
  /** The channel's capability (B-2.2): global mentors in community channels, a cohort's teachers and mentors, admins. */
  canModerate: boolean;
  /** Admins have the final say: only they restore a hidden message (B-2.5). */
  canRestore: boolean;
  /** Messages this reader reported in this visit. A report changes nothing else they can see. */
  reported: ReadonlySet<string>;
  /** The reader's own messages they asked to have reviewed in this visit. */
  reviewRequested: ReadonlySet<string>;
  markReported: (messageId: string) => void;
  markReviewRequested: (messageId: string) => void;
};

const EMPTY: ReadonlySet<string> = new Set();
const ModerationContext = createContext<ModerationContextValue>({
  actions: null, canReport: false, canModerate: false, canRestore: false, reported: EMPTY, reviewRequested: EMPTY, markReported: () => {}, markReviewRequested: () => {},
});

/**
 * Reporting and moderation for the messages below: the actions, whether this
 * reader moderates the channel, and what they did in this visit. It sits
 * above the list and the thread, so a message keeps its "Reported" when it
 * scrolls away and back, or shows in both.
 */
export function ModerationProvider({ actions, canReport, canModerate, canRestore, children }: {
  actions: ModerationActions | null; canReport: boolean; canModerate: boolean; canRestore: boolean; children: ReactNode;
}) {
  const [reported, setReported] = useState<ReadonlySet<string>>(EMPTY);
  const [reviewRequested, setReviewRequested] = useState<ReadonlySet<string>>(EMPTY);
  const value = useMemo<ModerationContextValue>(() => ({
    actions,
    canReport: canReport && actions !== null,
    canModerate: canModerate && actions !== null,
    canRestore: canModerate && canRestore && actions !== null,
    reported,
    reviewRequested,
    markReported: (id) => setReported((set) => new Set(set).add(id)),
    markReviewRequested: (id) => setReviewRequested((set) => new Set(set).add(id)),
  }), [actions, canReport, canModerate, canRestore, reported, reviewRequested]);
  return <ModerationContext.Provider value={value}>{children}</ModerationContext.Provider>;
}

export const useModeration = () => useContext(ModerationContext);

/** What this reader may do about one message. Deleted messages take nothing; nobody reports or hides their own. */
export function moderationRights(message: Message, viewerId: string | null, context: ModerationContextValue) {
  const own = message.authorKind === "USER" && viewerId !== null && message.author.id === viewerId;
  const hidden = message.moderation?.state === "HIDDEN";
  const open = context.actions !== null && !message.deleted && viewerId !== null;
  return {
    report: open && context.canReport && !own && !hidden,
    reported: context.reported.has(message.id),
    hide: open && context.canModerate && !own && !hidden,
    restore: open && context.canRestore && hidden,
    review: open && own && hidden,
  };
}

// ---- The author's (or a moderator's) note on a flagged or hidden message ----

/**
 * What a flagged or hidden message says about itself, to the people the
 * server tells. The author of a hidden message can ask for a review from
 * here, once; after that the note says it was asked.
 */
export function ModerationNote({ message, viewerId, onAskReview }: { message: Message; viewerId: string | null; onAskReview?: () => void }) {
  const context = useModeration();
  const notice = moderationNotice(message, viewerId);
  if (!notice) return null;
  const Icon = notice.state === "HIDDEN" ? PiEyeSlash : PiFlag;
  // The server says so on every read (B-2.5), so it survives a reload; this visit's request shows at once.
  const asked = message.moderation?.reviewRequested === true || context.reviewRequested.has(message.id);
  return (
    // Focusable from script only: where focus lands when a moderator's hide leaves the message with no actions.
    <div className="channel-moderation" data-moderation={notice.state} tabIndex={-1}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p>
          <strong className="font-semibold text-ink-primary">{notice.title}.</strong> {notice.detail}
        </p>
        {asked ? (
          <p className="channel-moderation__asked" tabIndex={-1} data-review-requested>
            <PiCheckCircle aria-hidden="true" className="size-4 shrink-0" />
            Review requested. An admin will look at it again.
          </p>
        ) : (
          onAskReview && (
            <Button size="sm" variant="quiet" className="mt-2" onClick={onAskReview} data-ask-review>
              Ask for review
            </Button>
          )
        )}
      </div>
    </div>
  );
}

/** Under a message this reader reported in this visit. The live region has already said it once. */
export function ReportedNote({ message }: { message: Message }) {
  const { reported } = useModeration();
  if (!reported.has(message.id)) return null;
  return (
    <p className="channel-reported" data-reported>
      <PiFlag aria-hidden="true" className="size-3.5 shrink-0" />
      You reported this. A moderator will look at it.
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

/** One in-place form under a message: a title, its fields, an error if the server refused, and two buttons. */
function Panel({ title, children, error, submitLabel, submitting, canSubmit, danger = false, onSubmit, onCancel, kind }: {
  title: string; children: ReactNode; error: string | null; submitLabel: string; submitting: boolean; canSubmit: boolean;
  danger?: boolean; onSubmit: () => void; onCancel: () => void; kind: string;
}) {
  const titleId = useId();
  const form = useRef<HTMLFormElement>(null);

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

  // Start where the person decides, the first field, with the whole form (its title too) in view.
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    element.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
    const reveal = () => element.scrollIntoView({ block: "nearest" });
    reveal();
    // Measured again once it has unfolded: during the opening it is a little shorter than at rest.
    element.addEventListener("animationend", reveal, { once: true });
    return () => element.removeEventListener("animationend", reveal);
  }, []);

  return (
    <form
      ref={form}
      aria-labelledby={titleId}
      className="channel-panel"
      data-panel={kind}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (canSubmit && !submitting) onSubmit();
      }}
    >
      <p id={titleId} className="channel-panel__title">
        {title}
      </p>
      {children}
      {error && (
        <p role="alert" className="channel-panel__error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant={danger ? "danger" : "primary"} loading={submitting} disabled={!canSubmit}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A labelled box for a reason or a note, with the server's limit. */
function ReasonBox({ label, hint, value, onChange, required = false }: {
  label: string; hint?: string; value: string; onChange: (value: string) => void; required?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink-primary">
        {label}
        {!required && <span className="font-normal text-ink-secondary"> (optional)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-ink-secondary">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        value={value}
        rows={2}
        maxLength={MAX_REASON}
        required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="channel-input min-h-16 w-full resize-y rounded-xl px-3 py-2"
      />
    </div>
  );
}

/** Report a message to the moderators: why, in a few choices, and anything they should know. */
export function ReportForm({ message, onDone, onCancel, announce }: PanelProps) {
  const { actions, markReported } = useModeration();
  const [choice, setChoice] = useState<ReportReasonKey | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();
  const reason = choice === null ? null : reportReason(choice, details);

  async function submit() {
    if (!actions || reason === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.report(message.id, reason);
      markReported(message.id);
      announce("Reported. A moderator will look at it.");
      onDone();
    } catch (failure) {
      setError(moderationFailure(failure, "report"));
      setSubmitting(false);
    }
  }

  const whose = message.authorKind === "TEMBO" ? "Tembo's answer" : `${firstName(message.author.name)}'s message`;
  return (
    <Panel
      kind="report"
      title={`Report ${whose}`}
      error={error}
      submitLabel="Send report"
      submitting={submitting}
      canSubmit={reason !== null}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-semibold text-ink-primary">What's wrong with it?</legend>
        {REPORT_REASONS.map((option) => (
          <label key={option.key} className="channel-choice">
            <input
              type="radio"
              name={name}
              value={option.key}
              checked={choice === option.key}
              onChange={() => setChoice(option.key)}
              className="channel-choice__input"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <ReasonBox
        label={choice === "other" ? "Tell the moderators what's wrong" : "Add details"}
        value={details}
        onChange={setDetails}
        required={choice === "other"}
      />
      <p className="text-[0.8125rem] text-ink-secondary">The message stays up while a moderator looks at it.</p>
    </Panel>
  );
}

const MODERATE_COPY: Record<InPlaceModeration, { title: string; label: string; submit: string; done: string }> = {
  hide: { title: "Hide this message from members", label: "Why are you hiding it?", submit: "Hide message", done: "Message hidden from members." },
  restore: { title: "Show this message to members again", label: "Why can it come back?", submit: "Restore message", done: "Message restored. Members can see it again." },
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
  const copy = MODERATE_COPY[action];
  const hint = moderateHint(message, action, canRestore);

  async function submit() {
    if (!actions || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.moderate(message.id, action, reason.trim());
      announce(copy.done);
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
      canSubmit={reason.trim().length > 0}
      danger={action === "hide"}
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <ReasonBox label={copy.label} hint={hint} value={reason} onChange={setReason} required />
    </Panel>
  );
}

/** The author asks an admin to look again at their hidden message. */
export function ReviewForm({ message, onDone, onCancel, announce }: PanelProps) {
  const { actions, markReviewRequested } = useModeration();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!actions) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.requestReview(message.id, note.trim() || null);
      markReviewRequested(message.id);
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
      canSubmit
      onSubmit={() => void submit()}
      onCancel={onCancel}
    >
      <ReasonBox label="Anything the reviewer should know" value={note} onChange={setNote} />
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
