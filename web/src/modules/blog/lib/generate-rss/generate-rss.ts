/**
 * generate-rss.ts
 * ----------------
 * Produces an RSS 2.0 feed from a collection of blog posts. This keeps the
 * implementation lightweight while still allowing consumers to subscribe to
 * updates.
 */

import { BlogPost } from "../get-posts/get-posts";

interface RssParams {
  /** Base URL of the site, used to construct absolute links. */
  siteUrl: string;
  /** Posts included in the feed. */
  posts: BlogPost[];
}

export function generateRss({ siteUrl, posts }: RssParams) {
  const items = posts
    .map(
      (p) =>
        `\n    <item>\n      <title><![CDATA[${
          p.title
        }]]></title>\n      <link>${siteUrl}/blog/${
          p.slug
        }</link>\n      <pubDate>${p.createdAt.toUTCString()}</pubDate>\n      <description><![CDATA[${
          p.content
        }]]></description>\n    </item>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>TTV Blog</title>\n    <link>${siteUrl}/blog</link>\n    <description>Updates from TTV</description>${items}\n  </channel>\n</rss>`;
}
