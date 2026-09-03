/**
 * Shared SEO primitives for `BaseLayout.astro`.
 *
 * The layout itself is unreachable from Vitest, so anything with a decision in
 * it lives here instead. Keep this module free of Astro imports.
 */

export const SITE_NAME = "Tembo Tech Ventures";

export const DEFAULT_DESCRIPTION =
  "Tembo Tech Ventures helps grow practical tech communities across Africa.";

/** Longest description Google will render before truncating. */
const MAX_DESCRIPTION_LENGTH = 160;

export type OgType = "website" | "article";

export interface SeoProps {
  title?: string;
  description?: string;
  /** Absolute URL, or a site-root-relative path such as `/blog/amina/hello`. */
  canonical?: string;
  /** Absolute URL, or a site-root-relative path. */
  ogImage?: string;
  ogType?: OgType;
  /** ISO 8601. Only meaningful when `ogType` is `"article"`. */
  publishedTime?: string;
  noIndex?: boolean;
}

/**
 * Resolve a path or URL against the configured site origin.
 *
 * Returns null when there is nothing usable to resolve, so callers can omit the
 * tag entirely rather than emit a relative or empty canonical — both of which
 * are worse than no canonical at all.
 */
export function absoluteUrl(
  site: URL | undefined,
  pathOrUrl: string | undefined
): string | null {
  if (!pathOrUrl) return null;

  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;

  // Already absolute: trust it as-is so posts can point at an off-site canonical
  // if we ever syndicate.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (!site) return null;

  try {
    return new URL(trimmed, site).toString();
  } catch {
    return null;
  }
}

/**
 * Collapse whitespace and clip to a length search engines will actually show.
 * Clips on a word boundary so we never emit a half-word followed by an ellipsis.
 */
export function normalizeDescription(
  description: string | undefined
): string | undefined {
  if (description === undefined) return undefined;

  const collapsed = description.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  if (collapsed.length <= MAX_DESCRIPTION_LENGTH) return collapsed;

  const clipped = collapsed.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = clipped.lastIndexOf(" ");
  // Guard against a single word longer than the limit, where lastIndexOf is -1.
  const base = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[.,;:!?-]+$/, "")}…`;
}

/**
 * Page title as it appears in the tab and in search results.
 *
 * Pages already pass fully-composed titles (`"Talent · Tembo Tech Ventures"`),
 * so this only appends the site name when it is genuinely missing.
 */
export function pageTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  if (!trimmed) return SITE_NAME;
  if (trimmed === SITE_NAME || trimmed.includes(SITE_NAME)) return trimmed;
  return `${trimmed} · ${SITE_NAME}`;
}
