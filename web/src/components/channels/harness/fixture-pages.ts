/**
 * DEV harness only: what the server would send each synthetic person for
 * each fixture channel. Messages are read from fixtures.ts; moderation is
 * shaped as the contract promises (state and reasons only for the author and
 * moderators, hidden messages only for them) and embeds as B-2.4 builds them.
 */
import type { Channel, Me, Message, MessageEmbedView, MessageList, ProjectEmbed, SessionClipEmbed } from "@/lib/platform/contracts";
import { channels, fixtureIds, messages, people, projects, sessionClip } from "@/lib/platform/fixtures";
import type { Shareables } from "../actions";

export const HARNESS_CHANNELS: Readonly<Record<string, Channel>> = Object.fromEntries(
  Object.values(channels).filter((channel) => channel.kind !== "DIRECT").map((channel) => [channel.slug, channel]),
);

const compare = (a: Message, b: Message) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/**
 * Who moderates a fixture channel, following B-2.2's rule (lib/channels/README.md): admins; global
 * mentors in community channels; a cohort's mentors in its channels. Teaching assignments are
 * server-only, so a TA persona does not moderate here.
 */
function canModerate(channel: Channel, me: Me): boolean {
  const { isAdmin, isMentor, mentorCohortIds } = me.capabilities;
  if (isAdmin) return true;
  if (channel.kind === "COMMUNITY") return isMentor;
  return channel.kind === "COHORT" && mentorCohortIds.includes(channel.programId ?? "");
}

/**
 * A project as the server sends it: B-2.4 gives a project no skills of its own (the owner's profile
 * skills are not this project's), so the fixtures' skills never reach a card.
 */
export const served = (project: ProjectEmbed): ProjectEmbed => ({ ...project, skills: [] });
const servedEmbed = (embed: MessageEmbedView): MessageEmbedView => (embed.type === "project" ? served(embed) : embed);

/**
 * One message as this person receives it, or null when they may not see it. Only the author and
 * admins learn whether a review was asked for (B-2.5).
 */
export function asSeenBy(fixture: Message, channel: Channel, me: Me): Message | null {
  const message = fixture.embeds.length > 0 ? { ...fixture, embeds: fixture.embeds.map(servedEmbed) } : fixture;
  const { moderation } = message;
  if (!moderation) return message;
  const own = message.author.id === me.user.id;
  if (!own && !canModerate(channel, me)) return moderation.state === "HIDDEN" ? null : { ...message, moderation: null };
  if (own || me.capabilities.isAdmin || moderation.reviewRequested === undefined) return message;
  const { reviewRequested: _private, ...shown } = moderation;
  return { ...message, moderation: shown };
}

/** The fixture channel this person may open, described as the server would to them; null when they may not. */
export function channelFor(slug: string, me: Me): Channel | null {
  const channel = HARNESS_CHANNELS[slug];
  if (!channel) return null;
  if (channel.kind === "COHORT" && !me.capabilities.cohortIds.includes(channel.programId ?? "") && !me.capabilities.isAdmin) return null;
  return canModerate(channel, me) ? { ...channel, capabilities: { ...channel.capabilities, canModerate: true } } : channel;
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
  return { projects: own.map(served), clips };
}
