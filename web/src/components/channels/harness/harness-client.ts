/**
 * DEV harness only: a fixture-backed channel API. Each channel's latest page
 * and threads come from fixture-pages; `arrive` queues messages that the next
 * `since` poll delivers, exactly as new messages from other people would.
 */
import { ROUTES, type ChannelRead, type Me, type Message, type MessageList } from "@/lib/platform/contracts";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import { createMockTransport } from "@/lib/platform/client/mockTransport";
import { channelFor, HARNESS_CHANNELS, threadPage } from "./fixture-pages";

export type HarnessClient = { api: ApiClient; arrive: (messages: readonly Message[]) => void };

export function createHarnessClient(me: Me, root: MessageList): HarnessClient {
  const queue: Message[] = [];
  let generation = 0;
  const empty = (thread: string | null, cursor: string): MessageList => ({
    items: [], beforeCursor: null, sinceCursor: cursor, thread, removedIds: [],
  });
  const channelById = (id: string) => {
    const slug = Object.values(HARNESS_CHANNELS).find((channel) => channel.id === id)?.slug;
    return slug ? channelFor(slug, me) : null;
  };

  const api = createApiClient({
    fetch: createMockTransport([
      {
        ...ROUTES.listMessages,
        reply: ({ request, params }) => {
          const query = new URL(request.url).searchParams;
          const thread = query.get("thread");
          const channel = channelById(params.id);
          if (!channel) return { status: 404, data: { error: { code: "not_found", message: "No such channel" } } };
          if (thread) return { data: query.has("since") || query.has("before") ? empty(thread, query.get("since") ?? "t") : threadPage(channel, thread, me) };
          if (query.has("before")) return { data: empty(null, root.sinceCursor) };
          if (query.has("since")) {
            const items = queue.splice(0).filter((message) => message.channelId === channel.id);
            if (items.length > 0) generation += 1;
            return { data: { ...empty(null, `${root.sinceCursor}-${generation}`), items } };
          }
          return { data: root };
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
    ]),
  });

  return { api, arrive: (messages) => queue.push(...messages) };
}
