/** PR C replaces this destination once the signed-in member route ships. Public surfaces do not use this helper. */
export function memberProfileHref(member: {
  handle: string;
  onPublicSite?: boolean | number;
}): string | null {
  return member.onPublicSite
    ? `/talent/${encodeURIComponent(member.handle)}`
    : null;
}
