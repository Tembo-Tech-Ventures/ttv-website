import { mentionsTembo } from "@/lib/tembo/mention";
import { ROUTES, type Id, type Message, type TemboFeedbackKind, type TemboUsage } from "../contracts";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";
import type { ChannelState, ChannelStore } from "./channel";
import { createStore, type Store } from "./store";

/**
 * Asking Tembo in a channel (S-3.1): what became of each question, today's
 * allowance and the reader's own "Helpful / Not quite" on answers.
 *
 * - `asking`: the request is on its way. `pending`: Tembo is working on it, and
 *   the answer will arrive in the thread through the channel's polling.
 * - `timeout`: no answer yet after `timeoutMs`. Checking again asks once more;
 *   the server never counts a question twice, and re-runs one whose run failed.
 * - `error`: the request was refused or failed. `exhausted`: no questions left
 *   until `usage.resetsAt`.
 */
export type TemboQuestionStatus = "asking" | "pending" | "answered" | "timeout" | "error" | "exhausted";
export interface TemboQuestion {
  messageId: Id;
  /** Where the answer goes: the asking message's own thread, or the thread it replied in. */
  threadId: Id;
  /** The asking message's server time; an answer is newer. */
  askedAt: number;
  status: TemboQuestionStatus;
  answerId: Id | null;
  error: ApiError | null;
}
export interface TemboState {
  /** Today's questions, from `/me` and then every ask; null while `tembo_channels` is off. */
  usage: TemboUsage | null;
  questions: Readonly<Record<Id, TemboQuestion>>;
  /** The reader's choice on each answer, including one the server has not confirmed. */
  feedback: Readonly<Record<Id, TemboFeedbackKind>>;
  /** Answers whose feedback is still being saved. */
  saving: readonly Id[];
  /** Polite aria-live text. */
  announcement: string;
}
export interface TemboOptions {
  channel: ChannelStore;
  /** `Me.temboUsage`. */
  usage: TemboUsage | null;
  /** `Me.flags.tembo_channels`. Defaults to false: nothing is asked while it is off. */
  enabled?: boolean;
  api?: ApiClient;
  /** Explicit fixture client. */
  mock?: ApiClient;
  now?: () => number;
  /** A question without an answer by then shows as timed out. Default 75 s. */
  timeoutMs?: number;
}

/** Tembo's whole run is bounded at 25 s on the server; polling may take up to 30 s more to bring the answer. */
export const TEMBO_TIMEOUT_MS = 75_000;

const asApiError = (error: unknown) => error instanceof ApiError ? error
  : new ApiError("client_error", 0, "Tembo request failed", undefined, { cause: error });
const isAbort = (error: ApiError) => error.code === "aborted";

export function createTemboStore(options: TemboOptions) {
  const { channel, enabled = false } = options;
  const api = options.api ?? options.mock ?? createApiClient();
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? TEMBO_TIMEOUT_MS;
  const store: Store<TemboState> = createStore<TemboState>({
    usage: enabled ? options.usage : null, questions: {}, feedback: {}, saving: [], announcement: "",
  });
  const timers = new Map<Id, ReturnType<typeof setTimeout>>();
  // The thread's reply count when Tembo started; a change while the thread is closed means "check".
  const baselines = new Map<Id, number>();
  const asking = new Map<Id, Promise<TemboQuestion>>();
  const controllers = new Set<AbortController>();
  let retains = 0;
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  const question = (id: Id) => store.getState().questions[id];
  function patch(id: Id, update: Partial<TemboQuestion>, announcement?: string) {
    store.setState(state => {
      const current = state.questions[id];
      if (!current) return state;
      return {
        ...state, questions: { ...state.questions, [id]: { ...current, ...update } },
        ...(announcement === undefined ? {} : { announcement }),
      };
    });
  }
  function setUsage(usage: TemboUsage) {
    store.setState(state => ({ ...state, usage }));
  }
  function clearTimer(id: Id) {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  }
  function wait(id: Id) {
    clearTimer(id);
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (question(id)?.status === "pending") patch(id, { status: "timeout" }, "Tembo hasn't answered yet");
    }, timeoutMs));
  }
  function answered(id: Id, answerId: Id) {
    clearTimer(id);
    baselines.delete(id);
    patch(id, { status: "answered", answerId, error: null }, "Tembo answered in the thread");
  }

  function request(id: Id): Promise<TemboQuestion> {
    const running = asking.get(id);
    if (running) return running;
    const controller = new AbortController();
    controllers.add(controller);
    const run = (async () => {
      try {
        const response = await api.call(ROUTES.askTembo, {
          params: { id: channel.channelId }, body: { messageId: id }, signal: controller.signal,
        });
        setUsage(response.usage);
        if (response.status === "answer") {
          channel.receive([response.message]);
          answered(id, response.message.id);
        } else {
          baselines.set(id, channel.peek(question(id)?.threadId ?? id)?.thread.replyCount ?? 0);
          const wasPending = question(id)?.status === "pending";
          patch(id, { status: "pending", error: null }, wasPending ? undefined : "Tembo is looking into it");
          wait(id);
        }
      } catch (caught) {
        const error = asApiError(caught);
        if (isAbort(error) || stopped) return question(id);
        clearTimer(id);
        if (error.status === 429 && error.code === "quota_exhausted") {
          const limit = store.getState().usage?.limit ?? options.usage?.limit ?? 0;
          setUsage({ used: limit, limit, resetsAt: now() + (error.retryAfterMs ?? 0) });
          patch(id, { status: "exhausted", error }, "You've used today's questions to Tembo");
        } else {
          patch(id, { status: "error", error }, "Tembo couldn't take that question");
        }
      } finally {
        controllers.delete(controller);
        asking.delete(id);
      }
      return question(id);
    })();
    asking.set(id, run);
    return run;
  }

  /**
   * Ask Tembo about one of the reader's own messages. A question already open
   * joins its request; asking again after a timeout, an error or an answer
   * reads the latest state (the server answers each message once).
   */
  function ask(message: Pick<Message, "id" | "parentId" | "createdAt">): Promise<TemboQuestion> {
    if (!enabled || stopped) return Promise.reject(new ApiError("flag_off", 0, "Tembo isn't available here"));
    const existing = question(message.id);
    if (existing && (existing.status === "asking" || existing.status === "pending")) return asking.get(message.id) ?? Promise.resolve(existing);
    const next: TemboQuestion = {
      messageId: message.id, threadId: message.parentId ?? message.id, askedAt: message.createdAt,
      status: "asking", answerId: existing?.answerId ?? null, error: null,
    };
    store.setState(state => ({ ...state, questions: { ...state.questions, [message.id]: next } }));
    return request(message.id);
  }

  /** A message the reader just posted: one that mentions `@tembo` asks, as the server does. */
  function noticeSent(message: Message) {
    if (enabled && !stopped && message.authorKind === "USER" && mentionsTembo(message.body)) ask(message).catch(() => undefined);
  }

  // Answers come through the channel's polling: in the open thread as replies, otherwise only as a
  // newer reply count on the thread's root, which is checked by asking again (it never counts twice).
  function observe(state: ChannelState) {
    const claimed = new Set(Object.values(store.getState().questions).map(q => q.answerId).filter(Boolean));
    const open = Object.values(store.getState().questions).filter(q => q.status === "pending" || q.status === "timeout")
      .toSorted((a, b) => a.askedAt - b.askedAt);
    for (const q of open) {
      if (state.thread?.parentId === q.threadId) {
        const reply = state.thread.messages.find(m => m.authorKind === "TEMBO" && m.createdAt >= q.askedAt && !claimed.has(m.id));
        if (reply) {
          claimed.add(reply.id);
          answered(q.messageId, reply.id);
          continue;
        }
      }
      const baseline = baselines.get(q.messageId);
      const root = channel.peek(q.threadId);
      if (baseline !== undefined && root && root.thread.replyCount > baseline && !asking.has(q.messageId)) {
        baselines.set(q.messageId, root.thread.replyCount);
        void request(q.messageId);
      }
    }
  }

  /**
   * Say whether an answer helped. Shows at once; a refusal or failure puts the
   * earlier choice back and rejects. The server keeps the latest choice.
   */
  async function sendFeedback(answerId: Id, feedback: TemboFeedbackKind): Promise<void> {
    if (!enabled || stopped) throw new ApiError("flag_off", 0, "Tembo isn't available here");
    const previous = store.getState().feedback[answerId];
    if (previous === feedback && !store.getState().saving.includes(answerId)) return;
    const withChoice = (choice: TemboFeedbackKind | undefined) => (state: TemboState) => {
      const { [answerId]: _old, ...rest } = state.feedback;
      return choice === undefined ? rest : { ...rest, [answerId]: choice };
    };
    store.setState(state => ({
      ...state, feedback: withChoice(feedback)(state), saving: [...state.saving.filter(id => id !== answerId), answerId], announcement: "",
    }));
    const controller = new AbortController();
    controllers.add(controller);
    try {
      await api.call(ROUTES.temboFeedback, { params: { id: answerId }, body: { feedback }, signal: controller.signal });
      store.setState(state => ({
        ...state, saving: state.saving.filter(id => id !== answerId),
        announcement: feedback === "helpful" ? "Thanks: marked helpful" : "Thanks: marked not quite",
      }));
    } catch (caught) {
      // Roll back only while this choice is still the latest one.
      store.setState(state => state.feedback[answerId] !== feedback ? state : {
        ...state, feedback: withChoice(previous)(state), saving: state.saving.filter(id => id !== answerId),
        announcement: stopped ? "" : "Couldn't save that. Try again.",
      });
      throw asApiError(caught);
    } finally {
      controllers.delete(controller);
    }
  }

  return {
    ...store,
    enabled,
    ask,
    /** Ask again about a question that timed out or failed. */
    retry(messageId: Id): Promise<TemboQuestion> {
      const q = question(messageId);
      if (!q) return Promise.reject(new ApiError("not_found", 0, "Nothing was asked about that message"));
      return ask({ id: q.messageId, parentId: q.threadId === q.messageId ? null : q.threadId, createdAt: q.askedAt });
    },
    noticeSent,
    sendFeedback,
    /** Questions about messages in this thread (its root and its replies), oldest first. */
    questionsIn(threadId: Id): TemboQuestion[] {
      return Object.values(store.getState().questions).filter(q => q.threadId === threadId).toSorted((a, b) => a.askedAt - b.askedAt);
    },
    clearAnnouncement() { store.setState(state => state.announcement ? { ...state, announcement: "" } : state); },
    /** Reference-counted: the first holder starts watching the channel; the last release stops every request and timer. */
    retain(): () => void {
      retains += 1;
      stopped = false;
      if (retains === 1) {
        unsubscribe = channel.subscribe(() => observe(channel.getState()));
        observe(channel.getState());
        // Questions still open from an earlier mount carry on.
        for (const q of Object.values(store.getState().questions)) {
          if (q.status === "pending") wait(q.messageId);
          else if (q.status === "asking") void request(q.messageId);
        }
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retains -= 1;
        if (retains > 0) return;
        unsubscribe?.();
        unsubscribe = null;
        stopped = true;
        for (const controller of controllers) controller.abort();
        for (const id of timers.keys()) clearTimer(id);
      };
    },
  };
}

export type TemboStore = ReturnType<typeof createTemboStore>;
