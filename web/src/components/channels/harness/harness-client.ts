/**
 * DEV harness and tests only: a fixture-backed channel API that behaves like
 * B-2.3 for one person. Each channel's latest page and threads come from
 * fixture-pages. Posts are idempotent on the client nonce; edits, deletions
 * and reactions apply to the person's own fixture copy. `arrive` queues
 * messages (or updates) that the next `since` poll delivers, exactly as other
 * people's would arrive.
 */
import {
  EditMessage, PostMessage, ReactToMessage, ROUTES, type Channel, type ChannelRead, type Me, type Message, type MessageEmbed,
  type MessageList, type ReactionKind,
} from "@/lib/platform/contracts";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import { createMockTransport, type MockOptions, type MockReply } from "@/lib/platform/client/mockTransport";
import { messages as fixtureMessages } from "@/lib/platform/fixtures";
import { sameEmbed, type Shareables } from "../actions";
import { asSeenBy, threadPage } from "./fixture-pages";

export type HarnessClient = {
  api: ApiClient;
  /** Deliver these through the next `since` poll: new messages from others, or changes to cached ones. */
  arrive: (messages: readonly Message[]) => void;
};

type HarnessOptions = {
  me: Me;
  channel: Channel;
  /** The latest page, as the server rendered it. */
  root: MessageList;
  /** The person's own work, which posts may attach. */
  shareables?: Shareables;
  now?: () => number;
  /** Refuse or fail requests, as MockOptions.failure. */
  failure?: MockOptions["failure"];
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

export function createHarnessClient({ me, channel, root, shareables, now = Date.now, failure }: HarnessOptions): HarnessClient {
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
  const empty = (thread: string | null, cursor: string): MessageList => ({ items: [], beforeCursor: null, sinceCursor: cursor, thread, removedIds: [] });

  function resolveEmbeds(refs: PostMessage["embeds"]): MessageEmbed[] | null {
    const owned: MessageEmbed[] = [...(shareables?.projects ?? []), ...(shareables?.clips ?? [])];
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
          if (thread) return { data: query.has("since") || query.has("before") ? empty(thread, query.get("since") ?? "t") : threadPage(channel, thread, me) };
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
        ...ROUTES.markChannelRead,
        reply: async ({ request, params }) => {
          const { messageId } = (await request.json()) as { messageId: string };
          const read: ChannelRead = { channelId: params.id, lastReadMessageId: messageId, unreadCount: 0 };
          return { data: read };
        },
      },
    ], { failure }),
  });

  return {
    api,
    arrive: (messages) => {
      for (const message of messages) known.set(message.id, message);
      queue.push(...messages);
    },
  };
}
