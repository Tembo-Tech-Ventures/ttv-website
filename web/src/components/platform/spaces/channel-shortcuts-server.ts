import { env } from "cloudflare:workers";
import type { Channel } from "@/lib/platform/contracts";
import { recordError } from "@/lib/observability/errors";
import { channelsServer } from "@/components/channels/server";
import { channelShortcuts, loadShortcutChannels, type ChannelShortcutsModel } from "./channel-shortcuts";
import { SPACE_PAGE_PATHS } from "./sidebar";
import type { SpacePageContext } from "./space-page";

/**
 * An overview page's "Channels" card, and the list it read, which the page hands to SpacePage so the
 * sidebar does not read it again. Nothing is read while `channels` is off for the person. Only `me`, the
 * space and the page are needed, so a page can start this before its onboarding is read.
 */
export async function loadChannelShortcuts(context: Pick<SpacePageContext, "me" | "space" | "page">): Promise<{ channels?: readonly Channel[]; shortcuts: ChannelShortcutsModel | null }> {
  const list = await loadShortcutChannels(
    context.me,
    () => channelsServer(env.DB, context.me).list(),
    (error) => recordError(env.DB, { source: "request", route: SPACE_PAGE_PATHS[context.page], error, level: "warning" }),
  );
  return { channels: list ?? undefined, shortcuts: channelShortcuts(context.me, context.space, list) };
}
