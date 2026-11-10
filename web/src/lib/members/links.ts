/** Links to an eligible public talent page, or null when the member has no public page. */
export function memberProfileHref(member: {
  handle: string;
  onPublicSite?: boolean | number;
}): string | null {
  return member.onPublicSite
    ? `/talent/${encodeURIComponent(member.handle)}`
    : null;
}
