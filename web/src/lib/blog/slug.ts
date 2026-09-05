import GithubSlugger from "github-slugger";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_SLUG_LENGTH = 80;

export const RESERVED_POST_SLUGS = new Set([
  "new",
  "edit",
  "delete",
  "draft",
  "drafts",
]);

export function slugifyTitle(title: string): string {
  const slugger = new GithubSlugger();
  const raw = slugger.slug(title);
  if (raw.length <= MAX_SLUG_LENGTH) return raw;
  const trimmed = raw.slice(0, MAX_SLUG_LENGTH);
  const lastHyphen = trimmed.lastIndexOf("-");
  return lastHyphen > 0 ? trimmed.slice(0, lastHyphen) : trimmed;
}

export type SlugValidationError =
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "double_hyphen"
  | "reserved";

export function validateSlug(
  slug: string
): { ok: true } | { ok: false; error: SlugValidationError } {
  if (slug.length === 0) return { ok: false, error: "too_short" };
  if (slug.length > MAX_SLUG_LENGTH) return { ok: false, error: "too_long" };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, error: "invalid_chars" };
  if (slug.includes("--")) return { ok: false, error: "double_hyphen" };
  if (RESERVED_POST_SLUGS.has(slug)) return { ok: false, error: "reserved" };
  return { ok: true };
}
