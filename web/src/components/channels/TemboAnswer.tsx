import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { PiChatsCircle, PiFolderSimple, PiUserCircle, PiVideoCamera } from "react-icons/pi";
import { cx } from "@/components/platform/ui/cx";
import Button, { FOCUS_RING } from "@/components/platform/ui/Button";
import TemboMark from "@/components/platform/ui/TemboMark";
import type { Channel, Citation, Message, TemboFeedbackKind, TemboUsage } from "@/lib/platform/contracts";
import { unaskedForToday, type TemboQuestion, type TemboState, type TemboStore } from "@/lib/platform/client/tembo";
import { temboReach, temboResetsIn, temboSees } from "./channel-format";

const ICON = "size-3.5 shrink-0 text-peach-ink";

export function citationIcon(citation: Citation) {
  switch (citation.type) {
    case "project":
      return <PiFolderSimple aria-hidden="true" className={ICON} />;
    case "sessionClip":
      return <PiVideoCamera aria-hidden="true" className={ICON} />;
    case "message":
      return <PiChatsCircle aria-hidden="true" className={ICON} />;
    case "profile":
      return <PiUserCircle aria-hidden="true" className={ICON} />;
  }
}

/* ---- The channel's Tembo store (S-3.1), for every part of the view ---- */

const TemboContext = createContext<TemboStore | null>(null);
const NO_QUESTIONS: TemboState = { usage: null, questions: {}, feedback: {}, saving: [], announcement: "" };
const unsubscribed = () => () => undefined;

/** Questions, allowance and feedback for this channel. Without a store, nothing is asked or rated. */
export function TemboProvider({ store, children }: { store: TemboStore | null; children: ReactNode }) {
  return <TemboContext.Provider value={store}>{children}</TemboContext.Provider>;
}

/** Select from the channel's Tembo state. Return stable values (state pieces or primitives). */
function useTemboState<T>(select: (state: TemboState) => T): T {
  const store = useContext(TemboContext);
  return useSyncExternalStore(
    store?.subscribe ?? unsubscribed,
    () => select(store?.getState() ?? NO_QUESTIONS),
    () => select(store?.getServerSnapshot() ?? NO_QUESTIONS),
  );
}

/** Today's allowance: the store's latest, else what the page was rendered with. */
export function useTemboUsage(fallback: TemboUsage): TemboUsage {
  return useTemboState((state) => state.usage) ?? fallback;
}

/* ---- An answer ---- */

const FEEDBACK: Record<TemboFeedbackKind, string> = { helpful: "Helpful", not_quite: "Not quite" };

/**
 * The line under a Tembo answer: what it could see (from the scope the server
 * stored with it) and "Helpful / Not quite". Today's questions are not here: a
 * live count under an old answer read as a fact about that answer (QA3-07); the
 * composer's line carries it.
 */
export function TemboAnswerFoot({ message }: { message: Message }) {
  const store = useContext(TemboContext);
  // A choice made here wins; until then, the one the server kept for this reader (after a reload, say).
  const choice = useTemboState((state) => state.feedback[message.id]) ?? message.temboFeedback ?? undefined;
  const saving = useTemboState((state) => state.saving.includes(message.id));
  // Rating needs the island: without JavaScript the buttons would do nothing.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (message.temboScope === null) return null;
  const rate = hydrated && store?.enabled === true && !message.deleted && message.moderation?.state !== "HIDDEN";
  return (
    <div className="channel-tembo__foot">
      <p>
        Sees: {temboSees(message.temboScope)}
      </p>
      {rate && (
        <fieldset aria-busy={saving || undefined} className="channel-tembo__rate">
          <legend className="sr-only">Did this answer help?</legend>
          {(Object.keys(FEEDBACK) as TemboFeedbackKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={choice === kind}
              onClick={() => store.sendFeedback(message.id, kind).catch(() => undefined)}
              className={cx("channel-tembo__choice", FOCUS_RING)}
              data-tembo-feedback={kind}
            >
              {FEEDBACK[kind]}
            </button>
          ))}
        </fieldset>
      )}
    </div>
  );
}

/* ---- A question still waiting ---- */

function failure(question: TemboQuestion): { text: string; retry: boolean } {
  if (question.error?.code === "flag_off") return { text: "Tembo isn't available in channels just now.", retry: false };
  switch (question.error?.status) {
    case 403:
      return { text: "Tembo answers your own messages, in channels you can post in.", retry: false };
    case 404:
    case 409:
      return { text: "Tembo can't answer this message: it was deleted or hidden, or the thread is closed.", retry: false };
    default:
      return { text: "Tembo couldn't take that question just now.", retry: true };
  }
}

function questionCopy(question: TemboQuestion, channel: Channel, usage: TemboUsage | null, where: "thread" | "channel") {
  switch (question.status) {
    case "asking":
    case "pending":
      return {
        text: where === "thread"
          ? `Looking through ${temboReach(channel)}. The answer will appear here.`
          : "Tembo is answering in the thread.",
        action: null,
      };
    case "timeout":
      return { text: "Tembo hasn't answered yet.", action: "Check again" };
    case "error": {
      const { text, retry } = failure(question);
      return { text, action: retry ? "Try again" : null };
    }
    case "exhausted": {
      const limit = usage?.limit ?? 0;
      const when = usage ? ` You can ask again after midnight East Africa Time, ${temboResetsIn(usage.resetsAt, Date.now())}.` : "";
      // In channels: the private Ask Tembo page has no daily count (QA3-04). Rebuilt after a reload
      // (no error), the note says what is known, not why: a mention edited in, or posted while Tembo
      // was off, was never asked either (unaskedForToday).
      const told = question.error === null
        ? `Tembo didn't take this question, and you've used all ${limit} of today's questions to Tembo in channels.`
        : `You've used all ${limit} of today's questions to Tembo in channels, so this one wasn't asked.`;
      return { text: `${told}${when} Questions on your private Ask Tembo page don't count toward this.`, action: null };
    }
    case "answered":
      return null;
  }
}

/**
 * Where an answer is on its way: a placeholder in the asking thread, or a line
 * under a question in the channel. Says when Tembo is slow, refused or out of
 * questions for today, and offers to check or try again where that can help.
 */
export function TemboWaiting({ question, channel, where }: { question: TemboQuestion; channel: Channel; where: "thread" | "channel" }) {
  const store = useContext(TemboContext);
  const usage = useTemboState((state) => state.usage);
  const copy = questionCopy(question, channel, usage, where);
  if (!copy) return null;
  const working = question.status === "asking" || question.status === "pending";
  // Tembo's placeholder only while Tembo has the question: a refusal is a note, not a reply (QA3-13).
  const asTembo = where === "thread" && question.status !== "exhausted" && question.status !== "error";
  return (
    <div
      className={cx("channel-tembo-wait", asTembo ? "channel-tembo-wait--thread" : "channel-tembo-wait--channel")}
      data-tembo-question={question.status}
    >
      {asTembo && <TemboMark size="md" decorative />}
      <div className="min-w-0">
        {asTembo && (
          <p className="channel-meta">
            <span className="channel-author">Tembo</span>
            <span className="channel-ai-badge">AI</span>
          </p>
        )}
        <p className={cx("channel-tembo-wait__text", asTembo && "channel-tembo-wait__card")}>
          {working && <span className="channel-tembo-wait__dots" aria-hidden="true"><span /><span /><span /></span>}
          {copy.text}
          {copy.action && store && (
            <Button size="sm" variant="ghost" onClick={() => void store.retry(question.messageId)} className="ml-2 align-middle">
              {copy.action}
            </Button>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Every unanswered question in this thread, oldest first, as placeholders under its replies: the
 * store's, and the reader's own `messages` here that today's used-up questions kept from being asked.
 */
export function ThreadQuestions({ threadId, channel, messages }: { threadId: string; channel: Channel; messages: readonly Message[] }) {
  const questions = useTemboState((state) => state.questions);
  const usage = useTemboState((state) => state.usage);
  const unasked = messages.flatMap((message) => {
    const question = questions[message.id] ? null : unaskedForToday(message, usage);
    return question?.threadId === threadId ? [question] : [];
  });
  const waiting = [...Object.values(questions).filter((q) => q.threadId === threadId && q.status !== "answered"), ...unasked]
    .toSorted((a, b) => a.askedAt - b.askedAt);
  if (waiting.length === 0) return null;
  return (
    <ol className="channel-messages" aria-label="Waiting for Tembo">
      {waiting.map((question) => (
        <li key={question.messageId}>
          <div className="channel-row">
            <TemboWaiting question={question} channel={channel} where="thread" />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Under a message in the channel: its own question to Tembo, while the answer is not in yet, or,
 * after a reload, that it wasn't asked because today's questions were used up (QA3-05).
 */
export function ChannelQuestion({ message, channel }: { message: Message; channel: Channel }) {
  const asked = useTemboState((state) => state.questions[message.id]);
  const usage = useTemboState((state) => state.usage);
  const question = asked ?? unaskedForToday(message, usage);
  if (!question || question.threadId !== message.id) return null;
  return <TemboWaiting question={question} channel={channel} where="channel" />;
}
