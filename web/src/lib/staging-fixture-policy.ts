import { channelReadMarkerPath, SPACES_APPLY_PATH, SPACES_MARK_READ_PATH, spacesReadPathAllowed } from "./staging-demo-policy";
import { legacySpacePath } from "./platform/server/space-routes";

/** A synthetic fixture never inherits real admin, recording or credential surfaces. */
export function stagingFixturePathAllowed(pathname: string, method: string): boolean {
  const path = legacySpacePath(pathname);
  if (["", "/community/members", "/community/mentors", "/community/institutions", "/dashboard/community", "/dashboard/discover", "/dashboard/mentorship", "/auth/logout", "/api/auth/get-session", "/api/auth/sign-out", "/api/mcp"].includes(path)) return true;
  if (path.startsWith("/api/community/") || path.startsWith("/_astro/")) return true;
  // Fixture cleanup deletes the user, which cascades to its own attention rows and channel read markers.
  if (path === SPACES_MARK_READ_PATH || channelReadMarkerPath(path)) return method === "POST";
  if (method !== "GET" && method !== "HEAD") return false;
  // The cohort space home is also the spaces entry, which redirects to an allowed space.
  return path === "/dashboard" || spacesReadPathAllowed(path) || path === SPACES_APPLY_PATH;
}
