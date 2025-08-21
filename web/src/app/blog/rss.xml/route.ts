/**
 * rss.xml/route
 * -------------
 * Server route that produces an RSS feed for the blog. Marking the handler as
 * `force-dynamic` prevents Next.js from trying to render the feed during the
 * build step when a database connection may not exist.
 */

import { NextResponse } from "next/server";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";
import { generateRss } from "@/modules/blog/lib/generate-rss/generate-rss";

export const dynamic = "force-dynamic";

export async function GET() {
  const posts = await getPosts();
  const rss = generateRss({ siteUrl: process.env.SITE_URL || "", posts });
  return new NextResponse(rss, {
    headers: {
      "Content-Type": "application/rss+xml",
    },
  });
}
