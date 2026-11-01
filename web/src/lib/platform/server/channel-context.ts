import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { findReadableChannel } from "@/lib/channels/access";
import { loadChannelPage, loadChannelShareables, type ChannelPage } from "@/lib/channels/page";
import * as schema from "@/lib/db/schema";
import type { Channel, ChannelShareables } from "../contracts";
import { requestCapabilities } from "./request-capabilities";
import { getSpaceContext } from "./space-context";
import { channelRoute, normalizeSpacePath } from "./space-routes";

const resolved = new WeakMap<App.Locals, { user: App.Locals["user"]; path: string; channel: Promise<Channel | null> }>();

/**
 * The channel a `/dashboard/<space>/c/<slug>` request names, for the router and the page frontmatter
 * alike: null unless `channels` is on for the caller and they can read it. One lookup per request.
 * Like getSpaceContext, it throws that function's Response denials and lets database errors propagate.
 */
export async function getRouteChannel(context: Pick<APIContext, "locals" | "url">): Promise<Channel | null> {
  const { locals, url } = context;
  const path = normalizeSpacePath(url.pathname);
  const route = channelRoute(path);
  if (!route || !locals.user) return null;
  const me = await getSpaceContext(context);
  if (!me.flags.channels) return null;
  let cached = resolved.get(locals);
  if (!cached || cached.user !== locals.user || cached.path !== path) {
    const db = drizzle(env.DB, { schema });
    cached = { user: locals.user, path, channel: requestCapabilities(db, locals).then((capabilities) => findReadableChannel(db, locals.user, route, capabilities)) };
    resolved.set(locals, cached);
  }
  return cached.channel;
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
