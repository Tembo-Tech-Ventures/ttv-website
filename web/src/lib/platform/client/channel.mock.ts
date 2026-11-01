import { ChannelList, MarkChannelRead, MessageList, ROUTES, type ChannelRead, type Message } from "../contracts";
import * as fixtures from "../fixtures";
import { createApiClient, type ApiClient } from "./apiClient";
import { compareMessages } from "./channelWindow";
import { createMockTransport } from "./mockTransport";

const scenePages = [fixtures.communityMessages, fixtures.communityThread, fixtures.cohortMessages, fixtures.cohortThread];

/**
 * Fixture-backed channel API for UI harnesses: the channel list, each channel's
 * latest page and threads, empty older/`since` pages, and read markers that
 * clear the channel's unread count. Each client is isolated; production code
 * never selects it.
 */
export function createChannelMockClient(): ApiClient {
  let channels = ChannelList.parse(fixtures.channelList).items;
  const all = new Map<string, Message>();
  for (const page of scenePages) for (const item of MessageList.parse(page).items) all.set(item.id, item);
  for (const item of Object.values(fixtures.messages)) if (!all.has(item.id)) all.set(item.id, item);

  function latest(channelId: string, thread: string | null): MessageList {
    const scene = scenePages.find(page => page.thread === thread && page.items[0]?.channelId === channelId);
    if (scene) return MessageList.parse(scene);
    const items = [...all.values()]
      .filter(item => item.channelId === channelId && item.parentId === thread)
      .toSorted(compareMessages);
    return { items, beforeCursor: null, sinceCursor: `mock-${channelId}-${thread ?? "root"}`, thread, removedIds: [] };
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
  ]) });
}
