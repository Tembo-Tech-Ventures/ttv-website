/** Sign in again and come back here: the way out of an expired session, from any overlay. */
export function signInHref(): string {
  const here = typeof window === "undefined" ? "/dashboard" : window.location.pathname + window.location.search;
  return `/auth/login?next=${encodeURIComponent(here)}`;
}
