// Qualified names are validated because raw D1 queries and Drizzle reads share these predicates.
import { sql, type SQLWrapper } from "drizzle-orm";
/**
 * Saved profiles are visible to signed-in members and institutions on the same terms.
 * Directory listings exclude mentors/admins; explicit channel shares may include staff's
 * own posted work. This shared predicate covers REST, tools, search and source retrieval,
 * so authorization happens before text reaches either a person or a model. Cohort
 * recordings/transcripts retain their separate access checks. Public listings additionally
 * require a completed cohort and checked work.
 */
export const DISCOVERY_EXCLUDED_ROLES = ["MENTOR", "ADMIN"] as const;
export const DISCOVERY_EXCLUDED_ROLES_SQL = DISCOVERY_EXCLUDED_ROLES.map(
  (role) => `'${role}'`,
).join(",");
const COLUMN = /^[a-z][A-Za-z_]*\.[a-z][A-Za-z_]*$/;
const ALIAS = /^[a-z][A-Za-z_]*$/;
export interface DiscoveryCaller {
  id: string;
}
function assertQualifiedColumn(column: string) {
  if (!COLUMN.test(column))
    throw new Error("Discovery eligibility needs a qualified column name.");
}
function assertAlias(alias: string) {
  if (!ALIAS.test(alias)) throw new Error("Eligibility needs an SQL alias.");
}
export function memberEligibility(column: string, includeStaff = false): string {
  assertQualifiedColumn(column);
  return `(EXISTS (SELECT 1 FROM studentProfile savedProfile WHERE savedProfile.userId=${column}
    AND savedProfile.status<>'SUSPENDED' AND coalesce(savedProfile.moderationOutcome,'pass')<>'hold')
    AND ${
      includeStaff
        ? "1"
        : `NOT EXISTS (SELECT 1 FROM UserRoles excludedRole JOIN Roles excludedRoleName ON excludedRoleName.id=excludedRole.roleId
    WHERE excludedRole.userId=${column} AND excludedRoleName.name IN (${DISCOVERY_EXCLUDED_ROLES_SQL}))`
    })`;
}
/** Admins and institutions use the same directory. Discovery lists exclude the caller; direct member reads retain the shared view. */
export function discoverableMember(
  column: string,
  caller: DiscoveryCaller,
): { clause: string; values: string[] } {
  return {
    clause: `(${memberEligibility(column)} AND ${column}<>?)`,
    values: [caller.id],
  };
}
export function publicProfileEligibility(alias: string): string {
  assertAlias(alias);
  return `(${memberEligibility(`${alias}.userId`)} AND ${alias}.status='PUBLISHED' AND EXISTS (
    SELECT 1 FROM programApplication completion WHERE completion.userId=${alias}.userId
    AND completion.status='COMPLETED' AND completion.completedAt IS NOT NULL))`;
}
/** Shared work follows its saved profile; private drafts and holds never enter shared sources. */
export function postedWorkEligibility(alias: string, includeStaff = false): string {
  assertAlias(alias);
  return `(${alias}.state='POSTED' AND ${alias}.moderatorHidden=0 AND coalesce(${alias}.moderationOutcome,'pass')<>'hold'
    AND ${memberEligibility(`${alias}.userId`, includeStaff)})`;
}

/** Drizzle relation callbacks supply their own aliased columns. */
export function postedWorkColumnsEligibility(
  work: {
    state: SQLWrapper;
    moderatorHidden: SQLWrapper;
    moderationOutcome: SQLWrapper;
    userId: SQLWrapper;
  },
  publicOnly = false,
) {
  return sql`${publicOnly ? sql`${work.moderationOutcome}='pass' AND` : sql``} ${work.state}='POSTED' AND ${work.moderatorHidden}=0 AND coalesce(${work.moderationOutcome},'pass')<>'hold'
 AND EXISTS(SELECT 1 FROM studentProfile eligibleOwner WHERE eligibleOwner.userId=${work.userId} AND ${sql.raw(memberEligibility("eligibleOwner.userId"))})`;
}
