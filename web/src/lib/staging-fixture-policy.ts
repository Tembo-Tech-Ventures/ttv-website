/** A synthetic fixture never inherits real admin, recording or credential surfaces. */
export function stagingFixturePathAllowed(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "");
  if (["", "/dashboard/community", "/dashboard/discover", "/dashboard/mentorship", "/auth/logout", "/api/auth/get-session", "/api/auth/sign-out", "/api/mcp"].includes(path)) return true;
  return path.startsWith("/api/community/") || path.startsWith("/_astro/");
}
