export const RESERVED_HANDLES = new Set([
  "admin",
  "api",
  "auth",
  "dashboard",
  "talent",
  "hire",
  "blog",
  "certificate",
  "www",
  "app",
  "staging",
  "mail",
  "about",
  "contact",
  "legal",
  "privacy",
  "terms",
  "ttv",
  "tembo",
  "root",
  "support",
  "help",
  "team",
  "careers",
  "new",
  "edit",
  "me",
  "profile",
  "profiles",
  "settings",
  // Reserved so they stay available as `/blog/<segment>/...` routes. Post URLs
  // are `/blog/[handle]/[slug]`, so a handle of "tags" would make
  // `/blog/tags/typescript` resolve to a person instead of a tag listing.
  "tags",
  "tag",
  "feed",
  "page",
  "archive",
  "rss",
  "search",
  "author",
  "authors",
]);

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export type HandleValidationError =
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "double_hyphen"
  | "reserved";

export function validateHandle(
  handle: string
): { ok: true } | { ok: false; error: HandleValidationError } {
  if (handle.length < 3) return { ok: false, error: "too_short" };
  if (handle.length > 39) return { ok: false, error: "too_long" };
  if (!HANDLE_PATTERN.test(handle))
    return { ok: false, error: "invalid_chars" };
  if (handle.includes("--")) return { ok: false, error: "double_hyphen" };
  if (RESERVED_HANDLES.has(handle)) return { ok: false, error: "reserved" };
  return { ok: true };
}
