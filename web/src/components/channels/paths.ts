import type { Channel } from "@/lib/platform/contracts";
import { SPACE_PATHS, type ChannelSpace } from "@/lib/platform/server/space-routes";

/**
 * Where channels live in the spaces (PLAN.md §4 "Proposed routes"; the router
 * is space-routes.ts): a cohort channel opens in Cohort, a community channel in
 * Community. Direct conversations arrive with mentor requests (Phase 4) and
 * have no page yet.
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
