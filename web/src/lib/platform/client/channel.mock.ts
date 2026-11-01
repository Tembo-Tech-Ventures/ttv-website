import {
  ChannelList, EditMessage, MarkChannelRead, MessageList, PostMessage, ReactToMessage, ROUTES, type AuthorSummary,
  type ChannelRead, type EmbedRef, type Message, type MessageEmbed,
} from "../contracts";
import * as fixtures from "../fixtures";
import { createApiClient, type ApiClient } from "./apiClient";
import { applyOverlay } from "./channel";
import { compareMessages } from "./channelWindow";
import { createMockTransport, type MockOptions } from "./mockTransport";

export interface ChannelMockOptions extends MockOptions {
  /** Who posts, edits and reacts. Defaults to the fixture persona Wanjiku. */
  viewer?: AuthorSummary;
  now?: () => number;
}

const scenePages = [fixtures.communityMessages, fixtures.communityThread, fixtures.cohortMessages, fixtures.cohortThread];

const sharedWork: readonly MessageEmbed[] = [...Object.values(fixtures.projects), fixtures.sessionClip];
const sameWork = (embed: MessageEmbed, ref: EmbedRef) => embed.type === "project" && ref.type === "project"
  ? embed.journeyId === ref.journeyId && embed.version === ref.version
  : embed.type === "sessionClip" && ref.type === "sessionClip" && embed.recordingId === ref.recordingId;
const refused = (status: number, code: string, message: string) => ({ status, data: { error: { code, message } } });

/**
 * Fixture-backed channel API for UI harnesses: the channel list, each channel's
 * latest page and threads, empty older/`since` pages, read markers that clear
 * the channel's unread count, and posts (idempotent on the nonce), edits,
 * deletions and reactions by `viewer`. Each client is isolated; production code
 * never selects it. `latencyMs` and `failure` pass through to the transport.
 */
export function createChannelMockClient({ viewer = fixtures.people.wanjiku, now = Date.now, ...transport }: ChannelMockOptions = {}): ApiClient {
  let channels = ChannelList.parse(fixtures.channelList).items;
  const all = new Map<string, Message>();
  for (const page of scenePages) for (const item of MessageList.parse(page).items) all.set(item.id, item);
  for (const item of Object.values(fixtures.messages)) if (!all.has(item.id)) all.set(item.id, item);
  const posted = new Map<string, Message>();
  let sequence = 0;

  function latest(channelId: string, thread: string | null): MessageList {
    const scene = scenePages.find(page => page.thread === thread && page.items[0]?.channelId === channelId);
    if (scene) {
      const page = MessageList.parse(scene);
      const added = [...posted.values()].filter(item => item.channelId === channelId && item.parentId === thread);
      return { ...page, items: [...page.items, ...added].map(item => all.get(item.id) ?? item).toSorted(compareMessages) };
    }
    const items = [...all.values()]
      .filter(item => item.channelId === channelId && item.parentId === thread)
      .toSorted(compareMessages);
    return { items, beforeCursor: null, sinceCursor: `mock-${channelId}-${thread ?? "root"}`, thread, removedIds: [] };
  }

  /** As B-2.3: only the author changes a message; editing a deleted one conflicts, deleting again repeats the placeholder. */
  function own(id: string, { deleting = false } = {}) {
    const message = all.get(id);
    if (!message) return { refusal: refused(404, "not_found", "That message is no longer here.") };
    if (message.author.id !== viewer.id) return { refusal: refused(403, "forbidden", "Only the author can change this message.") };
    if (message.deleted && !deleting) return { refusal: refused(409, "conflict", "That message was deleted.") };
    return { message };
  }

  function save(message: Message) {
    all.set(message.id, message);
    return { data: message };
  }

  return createApiClient({ fetch: createMockTransport([
    { ...ROUTES.listChannels, reply: () => ({ data: { items: channels } }) },
    { ...ROUTES.listMessages, reply: ({ request, params }) => {
      const query = new URL(request.url).searchParams;
      const thread = query.get("thread");
      const page = latest(params.id, thread);
      // The fixtures hold one page per scene: older pages are empty and nothing new arrives.
      if (query.has("before")) return { data: { ...page, items: [], beforeCursor: null } };
      if (query.has("since")) return { data: { ...page, items: [], beforeCursor: null, sinceCursor: query.get("since")! } };
      return { data: page };
    } },
    { ...ROUTES.markChannelRead, reply: async ({ request, params }) => {
      const body = MarkChannelRead.parse(await request.json());
      channels = channels.map(channel => channel.id === params.id ? { ...channel, unreadCount: 0 } : channel);
      const read: ChannelRead = { channelId: params.id, lastReadMessageId: body.messageId, unreadCount: 0 };
      return { data: read };
    } },
    { ...ROUTES.postMessage, reply: async ({ request, params }) => {
      const body = PostMessage.parse(await request.json());
      const replay = posted.get(body.clientNonce);
      if (replay) return { data: all.get(replay.id) ?? replay };
      const embeds = body.embeds.map(ref => sharedWork.find(embed => sameWork(embed, ref)));
      if (embeds.some(embed => embed === undefined)) return refused(400, "validation", "That work is not available to share.");
      sequence += 1;
      const createdAt = now();
      const message: Message = {
        id: `mock-message-${sequence}`, channelId: params.id, parentId: body.parentId, clientNonce: body.clientNonce,
        authorKind: "USER", author: viewer, body: body.body, embeds: embeds as MessageEmbed[], citations: [], reactions: [],
        createdAt, edited: false, deleted: false, moderation: null,
        thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, temboScope: null,
      };
      posted.set(body.clientNonce, message);
      return save(message);
    } },
    { ...ROUTES.editMessage, reply: async ({ request, params }) => {
      const { body } = EditMessage.parse(await request.json());
      const { message, refusal } = own(params.id);
      return refusal ?? save({ ...message, body, edited: true });
    } },
    { ...ROUTES.deleteMessage, reply: ({ params }) => {
      const { message, refusal } = own(params.id, { deleting: true });
      return refusal ?? save(applyOverlay(message, { deleted: true }));
    } },
    { ...ROUTES.reactToMessage, reply: async ({ request, params }) => {
      const { kind, active } = ReactToMessage.parse(await request.json());
      const message = all.get(params.id);
      if (!message || message.deleted) return refused(404, "not_found", "That message is no longer here.");
      const { reactions } = save(applyOverlay(message, { reactions: { [kind]: active } })).data;
      return { data: { messageId: message.id, reactions } };
    } },
  ], transport) });
}
