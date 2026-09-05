import type { FeedItem } from "./feed";
import { SITE_NAME } from "@/lib/seo";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildRssXml(
  siteOrigin: string,
  items: FeedItem[]
): string {
  const channel = items
    .map((item) => {
      const url = `${siteOrigin}${item.path}`;
      const lines = [
        `    <item>`,
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${item.publishedAt.toUTCString()}</pubDate>`,
        `      <dc:creator>${escapeXml(item.authorName)}</dc:creator>`,
      ];
      if (item.excerpt) {
        lines.push(
          `      <description>${escapeXml(item.excerpt)}</description>`
        );
      }
      lines.push(`    </item>`);
      return lines.join("\n");
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `  <channel>`,
    `    <title>${escapeXml(SITE_NAME)}</title>`,
    `    <link>${escapeXml(siteOrigin)}/blog</link>`,
    `    <description>Posts from the ${escapeXml(SITE_NAME)} community</description>`,
    `    <language>en</language>`,
    `    <atom:link href="${escapeXml(siteOrigin)}/blog/rss.xml" rel="self" type="application/rss+xml"/>`,
    channel,
    `  </channel>`,
    `</rss>`,
    ``,
  ].join("\n");
}
