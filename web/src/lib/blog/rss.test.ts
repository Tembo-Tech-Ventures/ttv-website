import { describe, expect, it } from "vitest";
import { buildRssXml } from "./rss";
import type { FeedItem } from "./feed";
import { SITE_NAME } from "../seo";

const SITE = "https://tembotechventures.com";

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    title: "My Post",
    path: "/blog/amina/my-post",
    excerpt: "A short summary",
    authorName: "Amina K",
    authorHandle: "amina",
    publishedAt: new Date("2026-06-15T12:00:00Z"),
    readingMinutes: 3,
    coverImageKey: null,
    coverImageAlt: null,
    ...overrides,
  };
}

describe("buildRssXml", () => {
  it("produces valid RSS 2.0 structure", () => {
    const xml = buildRssXml(SITE, [makeItem()]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("</channel>");
    expect(xml).toContain("</rss>");
  });

  it("includes the site name as channel title", () => {
    const xml = buildRssXml(SITE, []);
    expect(xml).toContain(`<title>${SITE_NAME}</title>`);
  });

  it("includes the feed self-link", () => {
    const xml = buildRssXml(SITE, []);
    expect(xml).toContain(
      `href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml"`
    );
  });

  it("renders an item with all fields", () => {
    const xml = buildRssXml(SITE, [makeItem()]);
    expect(xml).toContain("<item>");
    expect(xml).toContain("<title>My Post</title>");
    expect(xml).toContain(
      `<link>${SITE}/blog/amina/my-post</link>`
    );
    expect(xml).toContain(
      `<guid isPermaLink="true">${SITE}/blog/amina/my-post</guid>`
    );
    expect(xml).toContain("<dc:creator>Amina K</dc:creator>");
    expect(xml).toContain("<description>A short summary</description>");
    expect(xml).toContain("<pubDate>");
  });

  it("omits item description when excerpt is null", () => {
    const xml = buildRssXml(SITE, [makeItem({ excerpt: null })]);
    const itemXml = xml.slice(xml.indexOf("<item>"), xml.indexOf("</item>"));
    expect(itemXml).not.toContain("<description>");
  });

  it("renders multiple items", () => {
    const items = [
      makeItem({ title: "First" }),
      makeItem({ title: "Second", path: "/blog/amina/second" }),
    ];
    const xml = buildRssXml(SITE, items);
    expect(xml).toContain("<title>First</title>");
    expect(xml).toContain("<title>Second</title>");
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    expect(itemCount).toBe(2);
  });

  it("renders an empty feed with no items", () => {
    const xml = buildRssXml(SITE, []);
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });

  it("escapes XML special characters in title", () => {
    const xml = buildRssXml(SITE, [
      makeItem({ title: 'Hooks & <Effects> in "React"' }),
    ]);
    expect(xml).toContain("Hooks &amp; &lt;Effects&gt; in &quot;React&quot;");
    expect(xml).not.toContain("Hooks & <Effects>");
  });

  it("escapes XML special characters in author name", () => {
    const xml = buildRssXml(SITE, [
      makeItem({ authorName: "O'Reilly & Associates" }),
    ]);
    expect(xml).toContain("O&apos;Reilly &amp; Associates");
  });

  it("escapes XML special characters in excerpt", () => {
    const xml = buildRssXml(SITE, [
      makeItem({ excerpt: "Use <div> & <span>" }),
    ]);
    expect(xml).toContain("Use &lt;div&gt; &amp; &lt;span&gt;");
  });

  it("formats pubDate as RFC 2822 (UTC)", () => {
    const xml = buildRssXml(SITE, [
      makeItem({ publishedAt: new Date("2026-01-01T00:00:00Z") }),
    ]);
    expect(xml).toContain("<pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>");
  });
});
