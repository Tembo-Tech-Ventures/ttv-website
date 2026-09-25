import type { FeedItem } from "./feed";
import { buildRssXml } from "./rss";

export function buildRssResponse(siteOrigin: string, items: FeedItem[]): Response {
  return new Response(buildRssXml(siteOrigin, items), {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}
