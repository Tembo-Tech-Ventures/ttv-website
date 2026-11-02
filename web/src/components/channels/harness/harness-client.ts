/**
 * DEV harness and tests only: a fixture-backed channel API that behaves like
 * B-2.3 for one person. Each channel's latest page and threads come from
 * fixture-pages. Posts are idempotent on the client nonce; edits, deletions
 * and reactions apply to the person's own fixture copy. `arrive` queues
 * messages (or updates) that the next `since` poll delivers, exactly as other
 * people's would arrive.
 */
import {
  EditMessage, ModerationAction, TemboAsk, TemboFeedback, PostMessage, ReactToMessage, ReportMessage, RequestModerationReview, ROUTES, type Channel, type ChannelRead, type Me, type Message,
  type MessageEmbed, type MessageList, type ReactionKind, type SessionClipEmbed,
} from "@/lib/platform/contracts";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import { createMockTransport, type MockOptions, type MockReply } from "@/lib/platform/client/mockTransport";
import { messages as fixtureMessages, temboAuthor } from "@/lib/platform/fixtures";
import { sameEmbed, type Shareables } from "../actions";
import { asSeenBy, threadPage } from "./fixture-pages";

export type HarnessClient = {
  api: ApiClient;
  /** Deliver these through the next `since` poll: new messages from others, or changes to cached ones. */
  arrive: (messages: readonly Message[]) => void;
  /** Every read marker the view sent, oldest first. */
  reads: () => readonly string[];
  /** Reports and moderation decisions the view sent, oldest first. */
  moderation: () => readonly ModerationRecord[];
  /** Answer every question Tembo is working on, in its thread, through the next polls (as B-3.1's run would). */
  answerTembo: () => number;
  /** Questions asked (message ids) and feedback given, oldest first. */
  tembo: () => { asked: readonly string[]; feedback: readonly { messageId: string; feedback: string }[] };
};

export type ModerationRecord =
  | { kind: "report"; messageId: string; reason: string }
  | { kind: "hide" | "restore" | "keep"; messageId: string; reason: string }
  | { kind: "review"; messageId: string; note: string | null }
  | { kind: "undo"; messageId: string };

type HarnessOptions = {
  me: Me;
  channel: Channel;
  /** The latest page, as the server rendered it. */
  root: MessageList;
  /** The person's own work, which posts may attach. */
  shareables?: Shareables;
  /** The session moments that mention some words (`?q=`); "" gives every moment, which posts may attach too. */
  moments?: (q: string) => readonly SessionClipEmbed[];
  now?: () => number;
  /** Refuse or fail requests, as MockOptions.failure. */
  failure?: MockOptions["failure"];
};

const TEMBO_ANSWER: Record<Channel["kind"], string> = {
  COHORT: "Session 9 covers this from 34:12: the 200 tells the provider the callback arrived, so it stops retrying. [1]",
  COMMUNITY: "Revision 3 logs each callback before parsing it, so a failure can still be replayed. [1]",
  DIRECT: "Earlier in this conversation you agreed to replay the failing callback first.",
};
const TEMBO_CITATIONS: Record<Channel["kind"], Message["citations"]> = {
  COHORT: fixtureMessages.cohortAnswer.citations,
  COMMUNITY: fixtureMessages.communityAnswer.citations,
  DIRECT: [],
};

const refuse = (status: number, code: string, message: string): MockReply => ({ status, data: { error: { code, message } } });

function withReaction(message: Message, kind: ReactionKind, active: boolean): Message {
  const existing = message.reactions.find((reaction) => reaction.kind === kind);
  if ((existing?.mine ?? false) === active) return message;
  const count = Math.max(0, (existing?.count ?? 0) + (active ? 1 : -1));
  const reactions = existing
    ? message.reactions.map((reaction) => (reaction.kind === kind ? { ...reaction, count, mine: active } : reaction))
    : [...message.reactions, { kind, count, mine: active }];
  return { ...message, reactions: reactions.filter((reaction) => reaction.count > 0) };
}

export function createHarnessClient({ me, channel, root, shareables, moments, now = Date.now, failure }: HarnessOptions): HarnessClient {
  const queue: Message[] = [];
  let generation = 0;
  let sequence = 0;
  // Every message this person can see in this channel, by id: the fixtures and anything posted since.
  const known = new Map<string, Message>();
  for (const message of [...Object.values(fixtureMessages), ...root.items]) {
    const seen = message.channelId === channel.id ? asSeenBy(message, channel, me) : null;
    if (seen) known.set(seen.id, seen);
  }
  const byNonce = new Map<string, Message>();
  const reads: string[] = [];
  // Replies for each thread, delivered by that thread's next `since` poll.
  const threadQueues = new Map<string, Message[]>();
  // B-3.1 in miniature: each question counts once against today's allowance, and is answered once.
  let temboUsed = me.temboUsage.used;
  const asked: string[] = [];
  const waiting = new Set<string>();
  const answers = new Map<string, Message>();
  const feedback: { messageId: string; feedback: string }[] = [];
  const records: ModerationRecord[] = [];
  const empty = (thread: string | null, cursor: string): MessageList => ({ items: [], beforeCursor: null, sinceCursor: cursor, thread, removedIds: [] });

  function resolveEmbeds(refs: PostMessage["embeds"]): MessageEmbed[] | null {
    const owned: MessageEmbed[] = [...(shareables?.projects ?? []), ...(shareables?.clips ?? []), ...(moments?.("") ?? [])];
    const resolved = refs.map((ref) => owned.find((embed) => sameEmbed(embed, ref)));
    return resolved.every((embed): embed is MessageEmbed => embed !== undefined) ? resolved : null;
  }

  /** A change to one of this person's messages: 404 when unknown, 403 when not theirs, 409 when deleted. */
  function own(id: string): { message: Message } | { refused: MockReply } {
    const message = known.get(id);
    if (!message) return { refused: refuse(404, "not_found", "That message is no longer here.") };
    if (message.author.id !== me.user.id) return { refused: refuse(403, "forbidden", "Only the author can change a message.") };
    if (message.deleted) return { refused: refuse(409, "conflict", "That message was deleted.") };
    return { message };
  }

  function post(body: PostMessage): MockReply {
    const repeated = byNonce.get(body.clientNonce);
    if (repeated) return { status: 200, data: repeated };
    const embeds = resolveEmbeds(body.embeds);
    if (!embeds) return refuse(400, "validation", "That work is not available to share.");
    if (!channel.capabilities.canPost) return refuse(403, "forbidden", "Only the TTV team posts here.");
    sequence += 1;
    const message: Message = {
      id: `harness${String(sequence).padStart(4, "0")}${now().toString(36)}`, channelId: channel.id, parentId: body.parentId,
      clientNonce: body.clientNonce, authorKind: "USER", author: me.user, body: body.body, embeds, citations: [], reactions: [],
      createdAt: now(), edited: false, deleted: false, moderation: null,
      thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, temboScope: null,
    };
    known.set(message.id, message);
    byNonce.set(body.clientNonce, message);
    const parent = body.parentId ? known.get(body.parentId) : undefined;
    if (parent) {
      const participantIds = parent.thread.participantIds.includes(me.user.id) ? parent.thread.participantIds : [...parent.thread.participantIds, me.user.id];
      const updated = { ...parent, thread: { replyCount: parent.thread.replyCount + 1, participantIds, lastReplyAt: message.createdAt } };
      known.set(parent.id, updated);
      // The parent's reply count reaches the channel through the next poll, as the server's would.
      queue.push(updated);
    }
    return { status: 201, data: message };
  }

  function change(id: string, update: (message: Message) => Message): MockReply {
    const found = own(id);
    if ("refused" in found) return found.refused;
    const updated = update(found.message);
    known.set(id, updated);
    return { data: updated };
  }

  const api = createApiClient({
    retry: { maxRetries: 0 },
    fetch: createMockTransport([
      {
        ...ROUTES.listMessages,
        reply: ({ request, params }) => {
          if (params.id !== channel.id) return refuse(404, "not_found", "No such channel");
          const query = new URL(request.url).searchParams;
          const thread = query.get("thread");
          if (thread) {
            if (query.has("since")) {
              const items = threadQueues.get(thread)?.splice(0) ?? [];
              return { data: { ...empty(thread, `${query.get("since")}-${items.length}`), items } };
            }
            if (query.has("before")) return { data: empty(thread, "t") };
            const page = threadPage(channel, thread, me);
            const added = [...known.values()].filter((m) => m.parentId === thread && !page.items.some((item) => item.id === m.id));
            return { data: { ...page, items: [...page.items, ...added].toSorted((a, b) => a.createdAt - b.createdAt) } };
          }
          if (query.has("before")) return { data: empty(null, root.sinceCursor) };
          if (query.has("since")) {
            const items = queue.splice(0);
            if (items.length > 0) generation += 1;
            return { data: { ...empty(null, `${root.sinceCursor}-${generation}`), items } };
          }
          return { data: root };
        },
      },
      { ...ROUTES.postMessage, reply: async ({ request }) => post(PostMessage.parse(await request.json())) },
      {
        ...ROUTES.askTembo,
        reply: async ({ request }) => {
          const { messageId } = TemboAsk.parse(await request.json());
          const message = known.get(messageId);
          if (!message) return refuse(404, "not_found", "That message is no longer here.");
          if (message.author.id !== me.user.id) return refuse(403, "forbidden", "You can only ask about your own messages.");
          const usage = { ...me.temboUsage, used: temboUsed };
          const answer = answers.get(messageId);
          if (answer) return { status: 200, data: { status: "answer", message: answer, usage } };
          if (!waiting.has(messageId)) {
            if (temboUsed >= usage.limit) {
              return { status: 429, data: { error: { code: "quota_exhausted", message: "No questions left today.", retryAfterMs: Math.max(1, usage.resetsAt - now()) } } };
            }
            temboUsed += 1;
            waiting.add(messageId);
            asked.push(messageId);
          }
          return { status: 202, data: { status: "pending", messageId, usage: { ...usage, used: temboUsed } } };
        },
      },
      {
        ...ROUTES.temboFeedback,
        reply: async ({ request, params }) => {
          const body = TemboFeedback.parse(await request.json());
          const message = known.get(params.id);
          if (message?.authorKind !== "TEMBO") return refuse(404, "not_found", "That answer is no longer here.");
          feedback.push({ messageId: params.id, feedback: body.feedback });
          return { data: { ok: true } };
        },
      },
      {
        ...ROUTES.editMessage,
        reply: async ({ request, params }) => {
          const { body } = EditMessage.parse(await request.json());
          return change(params.id, (message) => ({ ...message, body, edited: true }));
        },
      },
      {
        ...ROUTES.deleteMessage,
        reply: ({ params }) => change(params.id, (message) => ({ ...message, body: "", embeds: [], citations: [], reactions: [], deleted: true })),
      },
      {
        ...ROUTES.reactToMessage,
        reply: async ({ request, params }) => {
          const { kind, active } = ReactToMessage.parse(await request.json());
          const message = known.get(params.id);
          if (!message || message.deleted) return refuse(404, "not_found", "That message is no longer here.");
          const updated = withReaction(message, kind, active);
          known.set(message.id, updated);
          return { data: { messageId: message.id, reactions: updated.reactions } };
        },
      },
      {
        ...ROUTES.listShareables,
        reply: ({ request, params }) => {
          if (params.id !== channel.id) return refuse(404, "not_found", "No such channel");
          const q = new URL(request.url).searchParams.get("q")?.trim();
          const offered = { projects: shareables?.projects ?? [], clips: shareables?.clips ?? [] };
          return { data: q ? { ...offered, clips: moments?.(q) ?? [] } : offered };
        },
      },
      {
        ...ROUTES.reportMessage,
        reply: async ({ request, params }) => {
          const { reason } = ReportMessage.parse(await request.json());
          const message = known.get(params.id);
          if (!message) return refuse(404, "not_found", "That message is no longer here.");
          if (message.deleted) return refuse(409, "conflict", "That message was deleted.");
          if (message.author.id === me.user.id) return refuse(403, "forbidden", "You can't report your own message.");
          // One report per person and message: a repeat changes nothing.
          if (!records.some((record) => record.kind === "report" && record.messageId === message.id)) {
            records.push({ kind: "report", messageId: message.id, reason });
          }
          return { data: { ok: true } };
        },
      },
      {
        ...ROUTES.moderateMessage,
        reply: async ({ request, params }) => {
          const { action, reason } = ModerationAction.parse(await request.json());
          const message = known.get(params.messageId);
          if (!message || message.deleted) return refuse(404, "not_found", "That message is no longer here.");
          if (!channel.capabilities.canModerate) return refuse(403, "forbidden", "You can't moderate this channel.");
          // Channel moderators hide; admins have the final say (B-2.5).
          if (action !== "hide" && !me.capabilities.isAdmin) return refuse(403, "forbidden", "Only an admin can do that.");
          const hidden = message.moderation?.state === "HIDDEN";
          if ((action === "hide") === hidden) return refuse(409, "conflict", "That message has already changed.");
          const updated: Message = {
            ...message,
            // A moderator's own hide stays theirs to take back until an admin decides; an admin's is final.
            moderation: action === "hide" ? { state: "HIDDEN", reasons: [reason], undoable: !me.capabilities.isAdmin } : { state: "VISIBLE", reasons: [] },
          };
          known.set(message.id, updated);
          records.push({ kind: action, messageId: message.id, reason });
          return { data: updated };
        },
      },
      {
        ...ROUTES.undoModerationHide,
        reply: ({ params }) => {
          const message = known.get(params.messageId);
          if (!message || message.deleted) return refuse(404, "not_found", "That message is no longer here.");
          if (message.moderation?.state !== "HIDDEN") return refuse(409, "conflict", "This message isn't hidden.");
          if (message.moderation.undoable !== true) return refuse(403, "forbidden", "Only the moderator who hid it can take the hide back.");
          const updated: Message = { ...message, moderation: { state: "VISIBLE", reasons: [] } };
          known.set(message.id, updated);
          records.push({ kind: "undo", messageId: message.id });
          return { data: updated };
        },
      },
      {
        ...ROUTES.requestModerationReview,
        reply: async ({ request, params }) => {
          const { note } = RequestModerationReview.parse(await request.json());
          const message = known.get(params.id);
          if (!message || message.deleted) return refuse(404, "not_found", "That message is no longer here.");
          if (message.author.id !== me.user.id) return refuse(403, "forbidden", "Only the author can ask for a review.");
          if (message.moderation?.state !== "HIDDEN") return refuse(409, "conflict", "This message isn't hidden.");
          if (message.moderation.reviewable === false) return refuse(409, "conflict", "An admin's decision on this message is final.");
          // Once per case: asking again changes nothing. Later reads say it was asked (B-2.5).
          if (!message.moderation.reviewRequested) {
            known.set(message.id, { ...message, moderation: { ...message.moderation, reviewRequested: true } });
            records.push({ kind: "review", messageId: message.id, note: note ?? null });
          }
          return { data: { ok: true } };
        },
      },
      {
        ...ROUTES.markChannelRead,
        reply: async ({ request, params }) => {
          const { messageId } = (await request.json()) as { messageId: string };
          reads.push(messageId);
          const read: ChannelRead = { channelId: params.id, lastReadMessageId: messageId, unreadCount: 0 };
          return { data: read };
        },
      },
    ], { failure }),
  });

  return {
    api,
    reads: () => [...reads],
    moderation: () => [...records],
    answerTembo: () => {
      for (const messageId of waiting) {
        const question = known.get(messageId);
        if (!question) continue;
        const threadId = question.parentId ?? question.id;
        sequence += 1;
        const answer: Message = {
          id: `harnesstembo${String(sequence).padStart(4, "0")}`, channelId: channel.id, parentId: threadId, clientNonce: null,
          authorKind: "TEMBO", author: temboAuthor, body: TEMBO_ANSWER[channel.kind], embeds: [], citations: TEMBO_CITATIONS[channel.kind],
          reactions: [], createdAt: now(), edited: false, deleted: false, moderation: null,
          thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, temboScope: channel.kind,
        };
        known.set(answer.id, answer);
        answers.set(messageId, answer);
        threadQueues.set(threadId, [...(threadQueues.get(threadId) ?? []), answer]);
        const parent = known.get(threadId);
        if (parent) {
          const updated = { ...parent, thread: { ...parent.thread, replyCount: parent.thread.replyCount + 1, lastReplyAt: answer.createdAt } };
          known.set(parent.id, updated);
          queue.push(updated);
        }
      }
      const count = waiting.size;
      waiting.clear();
      return count;
    },
    tembo: () => ({ asked: [...asked], feedback: [...feedback] }),
    arrive: (messages) => {
      for (const message of messages) known.set(message.id, message);
      queue.push(...messages);
    },
  };
}
