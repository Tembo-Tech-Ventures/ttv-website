/** Public calls to action retain their destination through the existing GitHub sign-in. */
export function communityEntryHref(isAuthenticated: boolean, institution = false): string {
  const destination = institution ? "/dashboard/discover" : "/dashboard/community";
  return isAuthenticated ? destination : `/auth/login?next=${encodeURIComponent(destination)}`;
}
