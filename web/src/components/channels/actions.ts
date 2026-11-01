import {
  ROUTES, type EmbedRef, type Message, type MessageEmbed, type PersonSummary, type ProjectEmbed, type ReactionKind,
  type SessionClipEmbed,
} from "@/lib/platform/contracts";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import type { ChannelStore } from "@/lib/platform/client/channel";

/**
 * Everything the channel view asks for that changes a channel. The view never
 * calls the API itself, so S-2.2's composer state (optimistic sends, drafts,
 * retries) can replace `createLiveActions` without touching a component.
 *
 * Each method resolves when the change is confirmed and the store holds the
 * server's copy, and rejects with the API's error otherwise.
 */
export interface ChannelActions {
  send(input: { body: string; parentId: string | null; embeds: readonly EmbedRef[] }): Promise<Message>;
  edit(messageId: string, body: string): Promise<Message>;
  remove(messageId: string): Promise<Message>;
  react(messageId: string, kind: ReactionKind, active: boolean): Promise<void>;
}

/** Work a person can attach from the composer, resolved by the page. */
export type Shareables = { projects: readonly ProjectEmbed[]; clips: readonly SessionClipEmbed[] };
export const NO_SHAREABLES: Shareables = { projects: [], clips: [] };

export function embedRef(embed: MessageEmbed): EmbedRef {
  return embed.type === "project"
    ? { type: "project", journeyId: embed.journeyId, version: embed.version }
    : { type: "sessionClip", recordingId: embed.recordingId, startSeconds: embed.startSeconds, durationSeconds: embed.durationSeconds };
}

export function sameEmbed(a: MessageEmbed | EmbedRef, b: MessageEmbed | EmbedRef): boolean {
  return a.type === "project" && b.type === "project"
    ? a.journeyId === b.journeyId && a.version === b.version
    : a.type === "sessionClip" && b.type === "sessionClip" && a.recordingId === b.recordingId && a.startSeconds === b.startSeconds;
}

/** Every cached copy of a message: the channel window, the open thread, or its parent. */
export function findMessage(store: ChannelStore, messageId: string): Message | undefined {
  const state = store.getState();
  return state.messages.find((m) => m.id === messageId)
    ?? state.thread?.messages.find((m) => m.id === messageId)
    ?? (state.thread?.parent?.id === messageId ? state.thread.parent : undefined);
}

let nonceCounter = 0;
/** A client nonce: unique per author, so a retried send is stored once. */
export function newNonce(): string {
  nonceCounter += 1;
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? Math.random().toString(36).slice(2);
  return `c${Date.now().toString(36)}${nonceCounter.toString(36)}${random}`.slice(0, 64);
}

function withReactions(message: Message, kind: ReactionKind, active: boolean): Message {
  const existing = message.reactions.find((reaction) => reaction.kind === kind);
  if ((existing?.mine ?? false) === active) return message;
  const count = Math.max(0, (existing?.count ?? 0) + (active ? 1 : -1));
  const reactions = existing
    ? message.reactions.map((reaction) => reaction.kind === kind ? { ...reaction, count, mine: active } : reaction)
    : [...message.reactions, { kind, count, mine: active }];
  return { ...message, reactions: reactions.filter((reaction) => reaction.count > 0) };
}

/**
 * The contract routes, confirmed by the server, then merged into the store.
 * Interim: S-2.2 brings optimistic sends, drafts and retries.
 */
export function createLiveActions(store: ChannelStore, api: ApiClient = createApiClient()): ChannelActions {
  return {
    async send({ body, parentId, embeds }) {
      const message = await api.call(ROUTES.postMessage, {
        params: { id: store.channelId }, body: { body, clientNonce: newNonce(), parentId, embeds: [...embeds] },
      });
      store.receive([message]);
      return message;
    },
    async edit(messageId, body) {
      const message = await api.call(ROUTES.editMessage, { params: { id: messageId }, body: { body } });
      store.receive([message]);
      return message;
    },
    async remove(messageId) {
      const message = await api.call(ROUTES.deleteMessage, { params: { id: messageId } });
      store.receive([message]);
      return message;
    },
    async react(messageId, kind, active) {
      const { reactions } = await api.call(ROUTES.reactToMessage, { params: { id: messageId }, body: { kind, active } });
      const cached = findMessage(store, messageId);
      if (cached) store.receive([{ ...cached, reactions }]);
    },
  };
}

/**
 * DEV harness only: confirms every change at once against the fixture store,
 * as the server would. Never selected by a production page.
 */
export function createFixtureActions(
  store: ChannelStore,
  { author, shareables = NO_SHAREABLES, now = () => Date.now() }: { author: PersonSummary; shareables?: Shareables; now?: () => number },
): ChannelActions {
  let sequence = 0;
  const require = (messageId: string) => {
    const message = findMessage(store, messageId);
    if (!message) throw new Error("That message is no longer here.");
    return message;
  };
  const resolve = (ref: EmbedRef): MessageEmbed => {
    const found = [...shareables.projects, ...shareables.clips].find((embed) => sameEmbed(embed, ref));
    if (!found) throw new Error("That work is not available to share.");
    return found;
  };
  return {
    async send({ body, parentId, embeds }) {
      sequence += 1;
      const createdAt = now();
      const message: Message = {
        id: `harness${String(sequence).padStart(4, "0")}${createdAt.toString(36)}`, channelId: store.channelId, parentId,
        clientNonce: newNonce(), authorKind: "USER", author, body, embeds: embeds.map(resolve), citations: [], reactions: [],
        createdAt, edited: false, deleted: false, moderation: null,
        thread: { replyCount: 0, participantIds: [], lastReplyAt: null }, temboScope: null,
      };
      const updates: Message[] = [message];
      if (parentId) {
        const parent = require(parentId);
        const participantIds = parent.thread.participantIds.includes(author.id)
          ? parent.thread.participantIds : [...parent.thread.participantIds, author.id];
        updates.push({ ...parent, thread: { replyCount: parent.thread.replyCount + 1, participantIds, lastReplyAt: createdAt } });
      }
      store.receive(updates);
      return message;
    },
    async edit(messageId, body) {
      const message = { ...require(messageId), body, edited: true };
      store.receive([message]);
      return message;
    },
    async remove(messageId) {
      const message: Message = { ...require(messageId), body: "", embeds: [], citations: [], reactions: [], deleted: true };
      store.receive([message]);
      return message;
    },
    async react(messageId, kind, active) {
      store.receive([withReactions(require(messageId), kind, active)]);
    },
  };
}
