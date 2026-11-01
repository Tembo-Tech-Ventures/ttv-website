import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { findReadableChannel } from "@/lib/channels/access";
import * as schema from "@/lib/db/schema";
import type { Channel } from "../contracts";
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
    cached = { user: locals.user, path, channel: findReadableChannel(drizzle(env.DB, { schema }), locals.user, route) };
    resolved.set(locals, cached);
  }
  return cached.channel;
}
