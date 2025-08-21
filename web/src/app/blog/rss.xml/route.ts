/**
 * RSS feed route for the blog.
 */

import { NextResponse } from "next/server";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";
import { generateRss } from "@/modules/blog/lib/generate-rss/generate-rss";

export async function GET() {
  const posts = await getPosts();
  const rss = generateRss({ siteUrl: process.env.SITE_URL || "", posts });
  return new NextResponse(rss, {
    headers: {
      "Content-Type": "application/rss+xml",
    },
  });
}
