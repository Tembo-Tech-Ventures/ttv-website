/**
 * Who institutional discovery may list or open (owner decision 2026-11-01,
 * QA1-09): people who have saved a community profile, who hold neither the
 * MENTOR nor the ADMIN role, and who are not the caller. The INSTITUTION role
 * never excludes an otherwise eligible member.
 *
 * REST search and Discover, chat tools, MCP and platform search all apply
 * this one fragment, so the surfaces cannot drift apart. It decides who is
 * discoverable, not what of theirs is visible: private contributions,
 * recordings and transcripts keep their own rules.
 */
export const DISCOVERY_EXCLUDED_ROLES = ["MENTOR", "ADMIN"] as const;

const COLUMN = /^[a-z][A-Za-z_]*\.[a-z][A-Za-z_]*$/;

/**
 * A parenthesised SQL condition on `column`, the candidate's user id, with one
 * bound value: the caller's id. `column` is an internal constant such as
 * "u.id", never request input; anything else throws.
 */
export function discoverableMember(column: string, callerId: string) {
  if (!COLUMN.test(column)) throw new Error("Discovery eligibility needs a qualified column name.");
  const excluded = DISCOVERY_EXCLUDED_ROLES.map(role => `'${role}'`).join(",");
  return {
    clause: `(EXISTS (SELECT 1 FROM communityProfile savedProfile WHERE savedProfile.userId=${column})
      AND NOT EXISTS (SELECT 1 FROM UserRoles excludedRole JOIN Roles excludedRoleName ON excludedRoleName.id=excludedRole.roleId
        WHERE excludedRole.userId=${column} AND excludedRoleName.name IN (${excluded}))
      AND ${column}<>?)`,
    values: [callerId] as [string],
  };
}
