/**
 * DEV harness only: what the server would send each synthetic person for
 * each fixture channel. Messages are read from fixtures.ts; moderation is
 * shaped as the contract promises (state and reasons only for the author and
 * moderators, hidden messages only for them).
 */
import type { Channel, Me, Message, MessageList, SessionClipEmbed } from "@/lib/platform/contracts";
import { channels, fixtureIds, messages, people, projects, sessionClip } from "@/lib/platform/fixtures";
import type { Shareables } from "../actions";

export const HARNESS_CHANNELS: Readonly<Record<string, Channel>> = Object.fromEntries(
  Object.values(channels).filter((channel) => channel.kind !== "DIRECT").map((channel) => [channel.slug, channel]),
);

const compare = (a: Message, b: Message) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

function canModerate(channel: Channel, me: Me): boolean {
  return channel.capabilities.canModerate || me.capabilities.isAdmin;
}

/** One message as this person receives it, or null when they may not see it. */
export function asSeenBy(message: Message, channel: Channel, me: Me): Message | null {
  if (!message.moderation) return message;
  const privileged = message.author.id === me.user.id || canModerate(channel, me);
  if (privileged) return message;
  if (message.moderation.state === "HIDDEN") return null;
  return { ...message, moderation: null };
}

/** The fixture channel this person may open, described as the server would to them; null when they may not. */
export function channelFor(slug: string, me: Me): Channel | null {
  const channel = HARNESS_CHANNELS[slug];
  if (!channel) return null;
  if (channel.kind === "COHORT" && !me.capabilities.cohortIds.includes(channel.programId ?? "") && !me.capabilities.isAdmin) return null;
  return me.capabilities.isAdmin ? { ...channel, capabilities: { ...channel.capabilities, canModerate: true } } : channel;
}

function page(items: Message[], channel: Channel, thread: string | null): MessageList {
  return { items, beforeCursor: null, sinceCursor: `harness-${channel.id}-${thread ?? "root"}`, thread, removedIds: [] };
}

export function channelPage(channel: Channel, me: Me): MessageList {
  const roots = Object.values(messages)
    .filter((message) => message.channelId === channel.id && message.parentId === null)
    .map((message) => asSeenBy(message, channel, me))
    .filter((message): message is Message => message !== null)
    .toSorted(compare);
  return page(roots, channel, null);
}

export function threadPage(channel: Channel, parentId: string, me: Me): MessageList {
  const replies = Object.values(messages)
    .filter((message) => message.channelId === channel.id && message.parentId === parentId)
    .map((message) => asSeenBy(message, channel, me))
    .filter((message): message is Message => message !== null)
    .toSorted(compare);
  return page(replies, channel, parentId);
}

const session07: SessionClipEmbed = {
  type: "sessionClip", recordingId: fixtureIds.session07, title: "Session 7 · Idempotency keys",
  startSeconds: 1120, durationSeconds: 75, quote: "Store the key before the side effect, not after.",
};

/** The person's own projects, and their cohort's session moments. */
export function shareablesFor(me: Me): Shareables {
  const own = Object.values(projects).filter((project) =>
    (project.journeyId === fixtureIds.chamaLedger && me.user.id === people.achieng.id)
    || (project.journeyId === fixtureIds.fareSplitter && me.user.id === people.wanjiku.id));
  const clips = me.capabilities.cohortIds.includes(fixtureIds.cohort04) ? [sessionClip, session07] : [];
  return { projects: own, clips };
}
