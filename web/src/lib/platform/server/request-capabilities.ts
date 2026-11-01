import type { Database } from "@/lib/db/schema";
import { capabilitiesFor, type PlatformCapabilities } from "./capabilities";

const resolved = new WeakMap<object, { user: App.Locals["user"]; capabilities: Promise<PlatformCapabilities> }>();

/**
 * capabilitiesFor once per request: `/me`, the space router, getRouteChannel, page frontmatter and
 * the channel APIs share one lookup through Astro.locals. Nothing outlives the request, so a
 * revoked role or assignment still takes effect on the very next one. Signing in or out during the
 * request (a new locals.user) computes them again. Database errors propagate to every caller.
 */
export function requestCapabilities(db: Database, locals: Pick<App.Locals, "user">): Promise<PlatformCapabilities> {
  let cached = resolved.get(locals);
  if (!cached || cached.user !== locals.user) {
    cached = { user: locals.user, capabilities: capabilitiesFor(db, locals.user) };
    resolved.set(locals, cached);
  }
  return cached.capabilities;
}
