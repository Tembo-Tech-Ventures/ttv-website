export interface SitemapEntry {
  path: string;
  lastmod?: Date;
}

export const STATIC_PUBLIC_ROUTES = ["/", "/talent", "/hire", "/blog"] as const;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteEntryUrl(siteOrigin: string, path: string): string {
  const origin = siteOrigin.endsWith("/") ? siteOrigin : `${siteOrigin}/`;
  return new URL(path.replace(/^\//, ""), origin).toString();
}

export function buildSitemapXml(
  siteOrigin: string,
  entries: SitemapEntry[]
): string {
  const urls = entries.map((entry) => {
    const lines = [
      "  <url>",
      `    <loc>${escapeXml(absoluteEntryUrl(siteOrigin, entry.path))}</loc>`,
    ];
    if (entry.lastmod) {
      lines.push(`    <lastmod>${entry.lastmod.toISOString()}</lastmod>`);
    }
    lines.push("  </url>");
    return lines.join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
