/** One eligibility rule for member reads; public listing additionally requires graduation. */
export const DISCOVERY_EXCLUDED_ROLES = ["MENTOR", "ADMIN"] as const;
export const DISCOVERY_EXCLUDED_ROLES_SQL = DISCOVERY_EXCLUDED_ROLES.map(role => `'${role}'`).join(",");
const COLUMN = /^[a-z][A-Za-z_]*\.[a-z][A-Za-z_]*$/;
const ALIAS = /^[a-z][A-Za-z_]*$/;
export interface DiscoveryCaller { id: string; isAdmin: boolean }
function checkedColumn(column: string) {
  if (!COLUMN.test(column)) throw new Error("Discovery eligibility needs a qualified column name.");
  return column;
}
function checkedAlias(alias: string) {
  if (!ALIAS.test(alias)) throw new Error("Eligibility needs an SQL alias.");
  return alias;
}
export function memberEligibility(column: string): string {
  checkedColumn(column);
  return `(EXISTS (SELECT 1 FROM studentProfile savedProfile WHERE savedProfile.userId=${column}
    AND savedProfile.status<>'SUSPENDED' AND coalesce(savedProfile.moderationOutcome,'pass')<>'hold')
    AND NOT EXISTS (SELECT 1 FROM UserRoles excludedRole JOIN Roles excludedRoleName ON excludedRoleName.id=excludedRole.roleId
    WHERE excludedRole.userId=${column} AND excludedRoleName.name IN (${DISCOVERY_EXCLUDED_ROLES_SQL})))`;
}
/** Admins and institutions use the same directory. Discovery lists exclude the caller; direct member reads retain the shared view. */
export function discoverableMember(column: string, caller: DiscoveryCaller): { clause: string; values: string[] } {
  return { clause: `(${memberEligibility(column)} AND ${column}<>?)`, values: [caller.id] };
}
export function publicProfileEligibility(alias: string): string {
  checkedAlias(alias);
  return `(${memberEligibility(`${alias}.userId`)} AND ${alias}.status='PUBLISHED' AND EXISTS (
    SELECT 1 FROM programApplication completion WHERE completion.userId=${alias}.userId
    AND completion.status='COMPLETED' AND completion.completedAt IS NOT NULL))`;
}
/** Shared work follows its saved profile; private drafts and holds never enter shared sources. */
export function postedWorkEligibility(alias: string): string {
  checkedAlias(alias);
  return `(${alias}.state='POSTED' AND coalesce(${alias}.moderationOutcome,'pass')<>'hold'
    AND ${memberEligibility(`${alias}.userId`)})`;
}
