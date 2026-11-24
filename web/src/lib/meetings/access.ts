import type { ChannelKind } from "@/lib/platform/contracts";
import {
  channelAccessFor, type ChannelAccessTarget, type PlatformCapabilities,
} from "@/lib/platform/server/capabilities";
import type { MeetingPurpose } from "./rules";

/**
 * Who may see, join and host a call (README.md beside this file, "Who may join"). A call's audience is
 * its channel's readers, decided by channelAccessFor like every channel surface, so the call and its
 * chat can never disagree; the purpose decides only who hosts. A global role alone grants nothing:
 * an admin outside a direct conversation, a mentor outside a cohort and an institution account get
 * exactly what the channel gives them.
 */

/** The one kind of channel each purpose lives in. A call whose channel is of another kind admits nobody. */
export const CHANNEL_KIND_FOR_PURPOSE = {
  SESSION: "COHORT", CHECKIN: "DIRECT", CALL: "DIRECT", EVENT: "COMMUNITY",
} as const satisfies Record<MeetingPurpose, ChannelKind>;

export interface MeetingAccess {
  /** The call's details and its card: everyone who reads its channel. */
  canSee: boolean;
  /** Taking a seat, while the channel still takes posts (an archived channel's calls are over). */
  canJoin: boolean;
  /** Opening the room, removing a member, ending the call, and scheduling one in this channel. */
  canHost: boolean;
}

const NO_ACCESS: MeetingAccess = Object.freeze({ canSee: false, canJoin: false, canHost: false });

/**
 * - SESSION, in a cohort channel: that cohort's readers (members, alumni, its instructors, TAs and
 *   invited mentors, admins) see and join; its instructors and TAs, and admins, host. Invited mentors
 *   moderate the channel but do not host its sessions.
 * - CALL and CHECKIN, in a direct conversation: its two members, and nobody else, admins included.
 *   Both host: either may open, end, or remove the other.
 * - EVENT, in a community channel: every reader (every signed-in person) sees and joins; the
 *   channel's moderators (admins and mentors) host.
 *
 * Pass isMember only for an explicit channel_member row of this caller.
 */
export function meetingAccessFor(
  capabilities: PlatformCapabilities,
  channel: ChannelAccessTarget,
  purpose: MeetingPurpose,
  { isMember = false }: { isMember?: boolean } = {},
): MeetingAccess {
  if (CHANNEL_KIND_FOR_PURPOSE[purpose] !== channel.kind) return NO_ACCESS;
  const access = channelAccessFor(capabilities, channel, { isMember });
  if (!access.canRead) return NO_ACCESS;
  const canJoin = channel.archivedAt === null;
  return { canSee: true, canJoin, canHost: canJoin && hosts(capabilities, channel, access.canModerate) };
}

function hosts(capabilities: PlatformCapabilities, channel: ChannelAccessTarget, moderates: boolean): boolean {
  switch (channel.kind) {
    case "COHORT":
      return channel.programId !== null
        && (capabilities.isAdmin || capabilities.teachingCohortIds.includes(channel.programId));
    // channelAccessFor admitted the caller only as one of the conversation's two members.
    case "DIRECT":
      return true;
    case "COMMUNITY":
      return moderates;
  }
}
