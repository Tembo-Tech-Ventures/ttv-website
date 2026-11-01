import type { Channel, Me } from "@/lib/platform/contracts";
import { channelList } from "@/lib/platform/fixtures";

/**
 * Harness only (/dev/platform-channels): the fixture channels a persona would
 * read, following the owner's decisions so the harness tells the same story
 * the backend will (B-2.2 owns the real rule). Community channels are open to
 * everyone signed in, institutions included (decision 7); a cohort's channels
 * to its members and mentors, and staff.
 */
export function harnessChannels(me: Me): Channel[] {
  const { cohortIds, mentorCohortIds, isAdmin } = me.capabilities;
  const cohorts = new Set([...cohortIds, ...mentorCohortIds]);
  return channelList.items.filter((channel) =>
    channel.kind === "COMMUNITY" || (channel.kind === "COHORT" && (isAdmin || cohorts.has(channel.programId!))));
}
