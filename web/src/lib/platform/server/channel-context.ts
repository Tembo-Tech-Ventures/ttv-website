import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { findChannelById, findReadableChannel } from "@/lib/channels/access";
import { loadChannelPage, loadChannelShareables, type ChannelPage } from "@/lib/channels/page";
import * as schema from "@/lib/db/schema";
import type { Channel, ChannelShareables } from "../contracts";
import { requestCapabilities } from "./request-capabilities";
import { getSpaceContext } from "./space-context";
import { channelRoute, conversationRoute, normalizeSpacePath } from "./space-routes";

const resolved = new WeakMap<App.Locals, { user: App.Locals["user"]; path: string; channel: Promise<Channel | null> }>();

/**
 * The lookup behind getRouteChannel, started at most once per request and path: the channel the path
 * names, if this caller can read it, from their capabilities alone. It does not wait for the rest of
 * the space context, so it runs beside it (PERF-2); only getRouteChannel hands its result out, once
 * that context allows channels. Never for a personal access token, which is refused before any
 * capability is read for it (me.ts).
 */
function lookUp(context: Pick<APIContext, "locals" | "url">): Promise<Channel | null> | null {
  const { locals, url } = context;
  const path = normalizeSpacePath(url.pathname);
  const route = channelRoute(path);
  const conversation = route ? null : conversationRoute(path);
  const user = locals.user;
  if ((!route && !conversation) || !user || locals.personalAccessToken) return null;
  let cached = resolved.get(locals);
  if (!cached || cached.user !== user || cached.path !== path) {
    const db = drizzle(env.DB, { schema });
    const channel = requestCapabilities(db, locals).then(async (capabilities) => {
      if (route) return findReadableChannel(db, user, route, capabilities);
      const found = conversation && await findChannelById(db, user, conversation.id, capabilities);
      return found?.kind === "DIRECT" ? found : null;
    });
    // Awaited later, or never when the context refuses the caller: an early failure is not unhandled.
    channel.catch(() => {});
    cached = { user, path, channel };
    resolved.set(locals, cached);
  }
  return cached.channel;
}

/** Starts the route channel's lookup beside the space context, for the router to await afterwards. */
export function startRouteChannel(context: Pick<APIContext, "locals" | "url">): void {
  lookUp(context);
}

/**
 * The channel a `/dashboard/<space>/c/<slug>` or `/dashboard/community/dm/<id>` request names, for the
 * router and the page frontmatter alike: null unless `channels` is on for the caller and they can read
 * it. A conversation path opens direct conversations only. One lookup per request. Like
 * getSpaceContext, it throws that function's Response denials and lets database errors propagate.
 */
export async function getRouteChannel(context: Pick<APIContext, "locals" | "url">): Promise<Channel | null> {
  const path = normalizeSpacePath(context.url.pathname);
  if ((!channelRoute(path) && !conversationRoute(path)) || !context.locals.user) return null;
  const channel = lookUp(context);
  const me = await getSpaceContext(context);
  return me.flags.channels && channel ? channel : null;
}

/**
 * The route channel and its first page for the page frontmatter (U-2.1): latest messages, the
 * `?thread=` replies and the read marker (src/lib/channels/page.ts), or null wherever
 * getRouteChannel is null. Server-rendered, so the channel reads without JavaScript. It never moves
 * the read marker.
 */
export async function getRouteChannelPage(
  context: Pick<APIContext, "locals" | "url">,
): Promise<{ channel: Channel; page: ChannelPage } | null> {
  const channel = await getRouteChannel(context);
  const user = context.locals.user;
  if (!channel || !user) return null;
  const page = await loadChannelPage(drizzle(env.DB, { schema }), env.DB, user.id, channel, {
    thread: context.url.searchParams.get("thread"),
  });
  return { channel, page };
}

/**
 * What the route channel's composer can attach (B-2.4): the caller's own published projects, and
 * session clips in their cohort's own channels, as U-2.1's Shareables. null wherever getRouteChannel
 * is null or the caller cannot post there, so the page shows no attach tools. Shares
 * getRouteChannel's one lookup per request.
 */
export async function getRouteChannelShareables(context: Pick<APIContext, "locals" | "url">): Promise<ChannelShareables | null> {
  const channel = await getRouteChannel(context);
  const user = context.locals.user;
  if (!channel || !user) return null;
  return loadChannelShareables(env.DB, user.id, channel);
}
