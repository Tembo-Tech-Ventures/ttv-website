import type { Channel } from "@/lib/platform/contracts";
import { channelPagePath, SPACE_PATHS, type ChannelSpace } from "@/lib/platform/server/space-routes";

/**
 * Where channels live in the spaces (PLAN.md §4 "Proposed routes"; the router
 * is space-routes.ts): a cohort channel opens in Cohort, a community channel in
 * Community. A private conversation (DIRECT, opened by an accepted mentor
 * request) has its own page under Community for its two members only, at
 * conversationPath; channelPath stays null for it, so a link that any reader
 * may follow (the admin moderation queue, the channel cards) never points at one.
 */

/** The space a channel opens in, or null for a kind that has no page yet. */
export function channelSpace(channel: Pick<Channel, "kind">): ChannelSpace | null {
  if (channel.kind === "COHORT") return "cohort";
  if (channel.kind === "COMMUNITY") return "community";
  return null;
}

/** The prefix of a space's channel pages: `/dashboard/community/c`. */
export function channelPathPrefix(space: ChannelSpace): string {
  return `${SPACE_PATHS[space]}/c`;
}

/** A channel's page, or null for a kind that has no page yet. The slug is opaque, so it is encoded. */
export function channelPath(channel: Pick<Channel, "kind" | "slug">): string | null {
  const space = channelSpace(channel);
  return space ? `${channelPathPrefix(space)}/${encodeURIComponent(channel.slug)}` : null;
}

/** A private conversation's page, for its members: `/dashboard/community/dm/<id>`. */
export function conversationPath(channel: Pick<Channel, "id">): string {
  return channelPagePath({ id: channel.id, kind: "DIRECT", slug: "" });
}

/**
 * The message list's id. Agreeing to the habits on a channel's page returns
 * here, so focus lands on the channel the person came for, not the top of a
 * new page (QA2-03).
 */
export const CHANNEL_MESSAGES_ID = "channel-messages";
