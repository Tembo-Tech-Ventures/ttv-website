import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/d1";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";
import { listPublicPosts } from "@/lib/blog/public";
import { toFeedItem } from "@/lib/blog/feed";
import { buildRssResponse } from "@/lib/blog/rss-route";

export const GET: APIRoute = async ({ site }) => {
  const db = drizzle(env.DB, { schema });
  const posts = await listPublicPosts(db);
  const origin = site?.origin ?? "https://tembotechventures.com";
  return buildRssResponse(origin, posts.map(toFeedItem));
};
