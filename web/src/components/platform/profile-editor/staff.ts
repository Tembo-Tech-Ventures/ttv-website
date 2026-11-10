import { DISCOVERY_EXCLUDED_ROLES_SQL } from "@/lib/community/eligibility";
import type { SpacePageContext } from "@/components/platform/spaces/space-page";

/**
 * Whether the caller is a mentor or TTV staff, whom the members directory and the public website
 * don't list (by decision), so pages that say who sees their profile say so. From the space
 * context's capabilities, or, without one (a personal access token, the flag off), from their roles.
 */
export async function isUnlistedStaff(context: SpacePageContext | null, db: D1Database, userId: string): Promise<boolean> {
  if (context) return context.me.capabilities.isMentor || context.me.capabilities.isAdmin;
  const row = await db
    .prepare(`SELECT 1 FROM UserRoles r JOIN Roles n ON n.id = r.roleId WHERE r.userId = ? AND n.name IN (${DISCOVERY_EXCLUDED_ROLES_SQL})`)
    .bind(userId)
    .first();
  return row !== null;
}
