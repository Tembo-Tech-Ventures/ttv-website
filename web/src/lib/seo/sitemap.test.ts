import { describe, expect, it } from "vitest";
import { buildSitemapXml, escapeXml, STATIC_PUBLIC_ROUTES } from "./sitemap";

describe("escapeXml", () => {
  it("escapes every character with XML meaning", () => {
    expect(escapeXml(`A&B <tag> "quote" 'apostrophe'`)).toBe(
      `A&amp;B &lt;tag&gt; &quot;quote&quot; &apos;apostrophe&apos;`
    );
  });
});

describe("buildSitemapXml", () => {
  it("builds a sitemap with static, profile, and post entries", () => {
    const xml = buildSitemapXml("https://tembotechventures.com", [
      ...STATIC_PUBLIC_ROUTES.map((path) => ({ path })),
      {
        path: "/talent/amina-preview",
        lastmod: new Date("2026-09-24T10:30:00.000Z"),
      },
      {
        path: "/blog/amina-preview/field-notes",
        lastmod: new Date("2026-09-25T08:00:00.000Z"),
      },
    ]);

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://tembotechventures.com/</loc>");
    expect(xml).toContain(
      "<loc>https://tembotechventures.com/talent/amina-preview</loc>"
    );
    expect(xml).toContain(
      "<loc>https://tembotechventures.com/blog/amina-preview/field-notes</loc>"
    );
    expect(xml).toContain("<lastmod>2026-09-25T08:00:00.000Z</lastmod>");
    expect((xml.match(/<url>/g) ?? [])).toHaveLength(6);
  });

  it("handles a trailing slash on the site origin without doubling it", () => {
    const xml = buildSitemapXml("https://tembotechventures.com/", [
      { path: "/blog" },
    ]);
    expect(xml).toContain("https://tembotechventures.com/blog");
    expect(xml).not.toContain(".com//blog");
  });

  it("escapes query separators in generated locations", () => {
    const xml = buildSitemapXml("https://example.com", [
      { path: "/search?one=1&two=2" },
    ]);
    expect(xml).toContain("?one=1&amp;two=2");
    expect(xml).not.toContain("?one=1&two=2");
  });
});
