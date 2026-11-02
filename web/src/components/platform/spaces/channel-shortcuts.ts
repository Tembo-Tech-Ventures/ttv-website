import type { Channel, Me, SpaceId } from "@/lib/platform/contracts";
import { channelPath, channelSpace } from "@/components/channels/paths";

/*
 * The "Channels" card on the Cohort and Community overviews and the Mentoring landing (QA2-16):
 * channels were reachable only from the sidebar or the menu, and testers had to guess. Nothing at
 * all while `channels` is off for the person. Which channels a person can read is the backend's
 * (channelsServer.list); this only picks the ones that belong on this page.
 */

/** How many the card links to; the rest are in the sidebar. */
export const SHORTCUT_LIMIT = 4;

export interface ChannelShortcut { id: string; href: string; name: string; unread: number }

export interface ChannelShortcutsModel {
  intro: string;
  channels: ChannelShortcut[];
  /** More channels than the card shows: the sidebar has them all. */
  more: boolean;
}

const KINDS: Partial<Record<SpaceId, readonly Channel["kind"][]>> = {
  cohort: ["COHORT"],
  community: ["COMMUNITY"],
  mentoring: ["COHORT", "COMMUNITY"],
};

const INTRO: Partial<Record<SpaceId, string>> = {
  cohort: "Talk with your cohort: questions about sessions, help with the work, and announcements.",
  community: "Talk with everyone in the community: introduce yourself, share what you're building, ask for help.",
  mentoring: "Members ask questions and share their work in channels. You can read and reply there.",
};

/** The card for this space, or null: the flag is off, the list could not be read, or nothing open belongs here. */
export function channelShortcuts(me: Me, space: SpaceId, channels: readonly Channel[] | null): ChannelShortcutsModel | null {
  const kinds = KINDS[space];
  if (!me.flags.channels || !channels || !kinds) return null;
  // Only channels whose space this person can open: a link must never lead to a page they can't see.
  const open = channels.flatMap((channel) => {
    const href = channelPath(channel);
    const opensIn = channelSpace(channel);
    return kinds.includes(channel.kind) && channel.archivedAt === null && href && opensIn && me.spaces.includes(opensIn)
      ? [{ id: channel.id, href, name: channel.name, unread: channel.unreadCount }]
      : [];
  });
  if (open.length === 0) return null;
  return { intro: INTRO[space]!, channels: open.slice(0, SHORTCUT_LIMIT), more: open.length > SHORTCUT_LIMIT };
}

/**
 * The channels this person can read, for the card (and the sidebar, which takes the same list), or null
 * while `channels` is off for them or the list could not be read (reported; the page renders without it).
 */
export async function loadShortcutChannels(
  me: Me,
  list: () => Promise<readonly Channel[]>,
  report: (error: unknown) => Promise<unknown>,
): Promise<readonly Channel[] | null> {
  if (!me.flags.channels) return null;
  try {
    return await list();
  } catch (error) {
    await report(error);
    return null;
  }
}
