/**
 * Who institutional discovery may list or open (owner decision 2026-11-01,
 * QA1-09): people who have saved a community profile, who hold neither the
 * MENTOR nor the ADMIN role, and who are not the caller. The INSTITUTION role
 * never excludes an otherwise eligible member.
 *
 * The decision covers institutions, not staff. Admins keep the reach they had
 * (coordinator decision on #255): every account except mentors and admins,
 * with or without a saved profile, including on surfaces institutions share.
 *
 * REST search and Discover, chat tools, MCP and platform search all apply
 * this one fragment, so the surfaces cannot drift apart. It decides who is
 * discoverable, not what of theirs is visible: private contributions,
 * recordings and transcripts keep their own rules.
 */
export const DISCOVERY_EXCLUDED_ROLES = ["MENTOR", "ADMIN"] as const;
/** The same roles as an SQL list literal, for queries that need the role exclusion alone. */
export const DISCOVERY_EXCLUDED_ROLES_SQL = DISCOVERY_EXCLUDED_ROLES.map(role => `'${role}'`).join(",");

const COLUMN = /^[a-z][A-Za-z_]*\.[a-z][A-Za-z_]*$/;

export interface DiscoveryCaller { id: string; isAdmin: boolean }

/**
 * A parenthesised SQL condition on `column`, the candidate's user id, and its
 * bound values (the caller's id, for non-admin callers). `column` is an
 * internal constant such as "u.id", never request input; anything else throws.
 */
export function discoverableMember(column: string, caller: DiscoveryCaller): { clause: string; values: string[] } {
  if (!COLUMN.test(column)) throw new Error("Discovery eligibility needs a qualified column name.");
  const notStaff = `NOT EXISTS (SELECT 1 FROM UserRoles excludedRole JOIN Roles excludedRoleName ON excludedRoleName.id=excludedRole.roleId
        WHERE excludedRole.userId=${column} AND excludedRoleName.name IN (${DISCOVERY_EXCLUDED_ROLES_SQL}))`;
  if (caller.isAdmin) return { clause: `(${notStaff})`, values: [] };
  return {
    clause: `(EXISTS (SELECT 1 FROM communityProfile savedProfile WHERE savedProfile.userId=${column})
      AND ${notStaff}
      AND ${column}<>?)`,
    values: [caller.id],
  };
}
