import { WebLink, type PersonSummary, type RoleBadge } from "@/lib/platform/contracts";

/**
 * People in mentor connections, as PersonSummary. Badges are for display, never permissions: the
 * global Staff, Mentor and Institution roles for everyone shown; cohort and alumni badges only for
 * the person asking, whose mentor sees them as context for the request (README.md beside this file).
 */

/** What a person's columns hold once read. */
export interface PersonRow {
  name: string | null;
  image: string | null;
  /** JSON array of global role names. */
  roles: string | null;
  /** JSON array of [status, programId, programName], or null when cohorts are not shown. */
  cohorts?: string | null;
}

/**
 * A person's columns, prefixed: `<prefix>Name`, `<prefix>Image`, `<prefix>Roles` and, with
 * `cohorts`, `<prefix>Cohorts`. `user` is the joined "user" alias, `userId` the id expression.
 */
export function personColumns(user: string, userId: string, prefix: string, { cohorts = false } = {}): string {
  const columns = [
    `${user}.name AS ${prefix}Name`, `${user}.image AS ${prefix}Image`,
    `(SELECT json_group_array(r.name) FROM UserRoles ur JOIN Roles r ON r.id = ur.roleId
      WHERE ur.userId = ${userId} AND r.name IN ('ADMIN', 'MENTOR', 'INSTITUTION')) AS ${prefix}Roles`,
  ];
  if (cohorts) {
    columns.push(`(SELECT json_group_array(json_array(pa.status, pg.id, pg.name)) FROM programApplication pa
      JOIN program pg ON pg.id = pa.programId
      WHERE pa.userId = ${userId} AND pa.status IN ('APPROVED', 'AUDIT', 'COMPLETED')) AS ${prefix}Cohorts`);
  }
  return columns.join(",\n  ");
}

/** The PersonRow under `prefix` in a row read with personColumns. */
export function personRow(row: Record<string, unknown>, prefix: string): PersonRow {
  const text = (key: string) => {
    const value = row[`${prefix}${key}`];
    return typeof value === "string" ? value : null;
  };
  return { name: text("Name"), image: text("Image"), roles: text("Roles"), cohorts: text("Cohorts") };
}

function jsonArray(text: string | null | undefined): unknown[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

type CohortRow = [status: string, programId: string, programName: string | null];
const isCohortRow = (value: unknown): value is CohortRow => Array.isArray(value) && typeof value[0] === "string"
  && typeof value[1] === "string" && (typeof value[2] === "string" || value[2] === null);

function badges(row: PersonRow): RoleBadge[] {
  const roles = new Set(jsonArray(row.roles).filter((value): value is string => typeof value === "string"));
  const result: RoleBadge[] = [];
  if (roles.has("ADMIN")) result.push({ kind: "STAFF", label: "Staff", programId: null });
  if (roles.has("MENTOR")) result.push({ kind: "MENTOR", label: "Mentor", programId: null });
  const cohorts = jsonArray(row.cohorts).filter(isCohortRow).toSorted((a, b) => (a[2] ?? "").localeCompare(b[2] ?? "") || a[1].localeCompare(b[1]));
  for (const [status, programId, name] of cohorts) {
    const cohort = name?.trim() || "Cohort";
    result.push(status === "COMPLETED"
      ? { kind: "ALUMNI", label: `Alumni · ${cohort}`, programId }
      : { kind: "COHORT", label: cohort, programId });
  }
  if (roles.has("INSTITUTION")) result.push({ kind: "INSTITUTION", label: "Institution partner", programId: null });
  return result;
}

export function personSummary(id: string, row: PersonRow): PersonSummary {
  const avatar = WebLink.safeParse(row.image);
  return { id, name: row.name?.trim() || "Member", avatarUrl: avatar.success ? avatar.data : null, roleBadges: badges(row) };
}
