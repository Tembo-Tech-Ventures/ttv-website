import type { Channel, Me, SpaceId } from "@/lib/platform/contracts";
import type { SidebarChannels } from "@/components/platform/spaces/sidebar";

/**
 * The channels a space's sidebar lists, or null to leave the sidebar exactly
 * as it was: when `channels` is off for the person, in a space that has no
 * channels, or when the list could not be read (the failure is reported and
 * the rest of the page renders). It never decides who may read a channel:
 * `list` is the backend's, and returns only what this person can read.
 */
export async function loadSidebarChannels(
  me: Me,
  space: SpaceId,
  list: () => Promise<readonly Channel[]>,
  report: (error: unknown) => Promise<unknown>,
  currentId: string | null = null,
): Promise<SidebarChannels | null> {
  if (!me.flags.channels || (space !== "community" && space !== "cohort")) return null;
  try {
    return { items: await list(), currentId };
  } catch (error) {
    await report(error);
    return null;
  }
}
