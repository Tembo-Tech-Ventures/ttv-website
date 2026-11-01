import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AuthorSummary, Channel, Me, Message, MessageEmbed } from "@/lib/platform/contracts";
import { ApiError } from "@/lib/platform/client/apiClient";
import { cx } from "@/components/platform/ui/cx";
import { embedRef, NO_SHAREABLES, sameEmbed, type ChannelActions, type Shareables } from "./actions";
import { composerTools, mentionsTembo, temboScope } from "./channel-format";
import { TEMBO_SEES } from "./TemboAnswer";
import { AttachedList, ComposerToolbar, MAX_EMBEDS, MentionList } from "./ComposerParts";
import { insertMention, mentionCandidates, mentionQuery, type MentionCandidate } from "./mentions";
import { useEnterSends } from "./useEnterSends";

/** About six lines; past that the box scrolls inside itself. */
const MAX_HEIGHT_PX = 168;
const MAX_BODY = 10_000;

type ComposerProps = {
  channel: Channel;
  me: Me;
  /** A reply goes into this thread; null posts to the channel. */
  parentId: string | null;
  actions: ChannelActions;
  /** Null: the page cannot list work to share yet, so no attach tools. */
  shareables: Shareables | null;
  /** People `@` can reach (S-2.2 brings the channel's members). */
  people: readonly AuthorSummary[];
  /** In a thread: who has written in it, so suggestions can say "in this thread". */
  threadPeople?: ReadonlySet<string>;
  /** The box's name: "Message #show-your-work". */
  label: string;
  variant?: "channel" | "thread";
  onSent?: (message: Message) => void;
};

/** Why a send failed, in words that say what to do next. */
export function sendError(error: unknown): string {
  switch (error instanceof ApiError ? error.code : null) {
    case "rate_limited":
      return "You're sending quickly. Wait a moment, then send again.";
    case "moderation_rejected":
      return (error as ApiError).message;
    case "forbidden":
    case "flag_off":
      return "You can't post here right now.";
    case "validation":
      return "That message couldn't be sent as written. Check it and try again.";
    default:
      return "Couldn't send. Your message is still here; try again.";
  }
}

/**
 * The text box and its caret: what is typed, where the caret is, and a way
 * to replace the text and put the caret somewhere after React renders it.
 */
function useDraft() {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const textarea = box.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
    if (pending.current === null) return;
    textarea.setSelectionRange(pending.current, pending.current);
    setCaret(pending.current);
    pending.current = null;
  }, [text]);

  return {
    text, caret, box,
    type(next: string, at: number) {
      setText(next);
      setCaret(at);
    },
    replace(next: string, at: number) {
      setText(next);
      pending.current = at;
      box.current?.focus();
    },
    moveCaret: setCaret,
    clear() {
      setText("");
      setCaret(0);
    },
  };
}

/** The `@` picker: which suggestions show, which is active, and Escape dismissing one mention. */
function useMentionPicker(text: string, caret: number, options: Parameters<typeof mentionCandidates>[1]) {
  const mention = mentionQuery(text, caret);
  const start = mention?.start ?? null;
  const typed = mention?.query ?? null;
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const { people, tembo, temboDescription, where } = options;
  const candidates = useMemo(
    () => (typed !== null && start !== dismissed ? mentionCandidates(typed, { people, tembo, temboDescription, where }) : []),
    [typed, start, dismissed, people, tembo, temboDescription, where],
  );
  useEffect(() => setActive(0), [typed]);
  const index = Math.min(active, Math.max(0, candidates.length - 1));
  return {
    start, candidates, active: index, open: candidates.length > 0,
    current: candidates[index] as MentionCandidate | undefined,
    move: (step: 1 | -1) => setActive((value) => (value + step + candidates.length) % candidates.length),
    dismiss: () => setDismissed(start),
    reset: () => setDismissed(null),
  };
}

/**
 * Write a message or a reply. Enter sends with a keyboard and adds a line on
 * a touch screen; the send button is always there. `@` offers Tembo (when it
 * is on) and the people here. Share project, and in cohort channels only,
 * Session clip, attach work.
 *
 * A normal flex child, never `position: fixed`: the on-screen keyboard does
 * not shrink the layout viewport a fixed element is placed against.
 */
export default function Composer({
  channel, me, parentId, actions, shareables, people, threadPeople, label, variant = "channel", onSent,
}: ComposerProps) {
  const tools = composerTools(channel, me.flags);
  const draft = useDraft();
  const [attached, setAttached] = useState<MessageEmbed[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enterSends = useEnterSends();
  const id = useId();
  const listId = `${id}-mentions`;
  const scope = temboScope(channel);
  const thread = variant === "thread";
  const where = useCallback(
    (person: AuthorSummary) => (threadPeople?.has(person.id ?? "") ? "in this thread" : "in this channel"),
    [threadPeople],
  );
  // In a thread, the people already in it come first.
  const ranked = useMemo(
    () => (threadPeople ? [...people].toSorted((a, b) => Number(threadPeople.has(b.id ?? "")) - Number(threadPeople.has(a.id ?? ""))) : people),
    [people, threadPeople],
  );
  const picker = useMentionPicker(draft.text, draft.caret, {
    people: ranked, tembo: tools.askTembo, temboDescription: `Answers from ${TEMBO_SEES[channel.kind]}`, where,
  });

  const body = draft.text.trim();
  const tooLong = draft.text.length > MAX_BODY;
  const canSend = body.length > 0 && !tooLong && !sending;

  function replace(next: string, at: number) {
    draft.replace(next, at);
    setError(null);
  }

  function choose(candidate: MentionCandidate) {
    if (picker.start === null) return;
    const next = insertMention(draft.text, picker.start, draft.caret, candidate.insert);
    replace(next.text, next.caret);
  }

  /** "@" at the caret, so the picker opens there. */
  function startMention() {
    const at = draft.box.current?.selectionStart ?? draft.text.length;
    const lead = at > 0 && !/\s/.test(draft.text[at - 1]) ? " @" : "@";
    picker.reset();
    replace(`${draft.text.slice(0, at)}${lead}${draft.text.slice(at)}`, at + lead.length);
  }

  /** Address the message to Tembo, once, at the start. */
  function askTembo() {
    if (mentionsTembo(draft.text)) {
      draft.box.current?.focus();
      return;
    }
    const rest = draft.text.replace(/^\s+/, "");
    replace(`@tembo ${rest}`, 7 + rest.length);
  }

  function attach(embed: MessageEmbed) {
    setAttached((list) => (list.some((item) => sameEmbed(item, embed)) || list.length >= MAX_EMBEDS ? list : [...list, embed]));
    requestAnimationFrame(() => draft.box.current?.focus());
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const message = await actions.send({ body, parentId, embeds: attached.map(embedRef) });
      draft.clear();
      setAttached([]);
      onSent?.(message);
    } catch (failure) {
      setError(sendError(failure));
    } finally {
      setSending(false);
      draft.box.current?.focus();
    }
  }

  function pickerKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!picker.current) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") picker.move(event.key === "ArrowDown" ? 1 : -1);
    else if (event.key === "Enter" || event.key === "Tab") choose(picker.current);
    else if (event.key === "Escape") {
      event.stopPropagation();
      picker.dismiss();
    } else return false;
    event.preventDefault();
    return true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || pickerKey(event)) return;
    if (event.key === "Enter" && enterSends && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className={cx("channel-composer", thread && "channel-composer--thread")} data-composer={variant}>
      {picker.open && (
        <MentionList
          listId={listId}
          candidates={picker.candidates}
          active={picker.active}
          scope={scope}
          usage={me.temboUsage}
          onChoose={choose}
        />
      )}

      <form
        className="channel-composer__box"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <textarea
          id={id}
          ref={draft.box}
          rows={1}
          value={draft.text}
          placeholder={thread ? "Reply in thread…" : `${label}…`}
          enterKeyHint={enterSends ? "send" : "enter"}
          aria-describedby={`${id}-hint`}
          aria-controls={picker.open ? listId : undefined}
          aria-activedescendant={picker.open ? `${listId}-${picker.active}` : undefined}
          onChange={(event) => {
            draft.type(event.target.value, event.target.selectionStart);
            setError(null);
          }}
          onSelect={(event) => draft.moveCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={picker.dismiss}
          onFocus={picker.reset}
          className="channel-composer__input"
        />
        <AttachedList attached={attached} onRemove={(embed) => setAttached((list) => list.filter((item) => !sameEmbed(item, embed)))} />
        <ComposerToolbar
          tools={tools}
          shareables={shareables ?? NO_SHAREABLES}
          attachments={!thread && shareables !== null}
          thread={thread}
          canSend={canSend}
          sending={sending}
          attached={attached}
          onPick={attach}
          onMention={startMention}
          onAskTembo={askTembo}
        />
      </form>

      <p id={`${id}-hint`} className="sr-only">
        {enterSends ? "Enter sends, Shift and Enter adds a line." : "Use the send button to send."} Type @ to mention someone.
      </p>
      <p className="sr-only" aria-live="polite">
        {picker.open ? `${picker.candidates.length} ${picker.candidates.length === 1 ? "suggestion" : "suggestions"}. Up and down to choose, Enter to insert, Escape to close.` : ""}
      </p>
      {tooLong && <p className="channel-composer__note text-danger-ink">{draft.text.length - MAX_BODY} characters over the limit.</p>}
      {error && (
        <p role="alert" className="channel-composer__note text-danger-ink">
          {error}
        </p>
      )}
      {!thread && tools.askTembo && (
        <p className="channel-composer__scope">
          <span className="font-semibold text-ink-secondary">Tembo</span> · Sees: {scope} · You: {me.temboUsage.used} of {me.temboUsage.limit} today
        </p>
      )}
    </div>
  );
}
