import type { Me } from "@/lib/platform/contracts";

/** The application statuses that make someone part of a cohort, as its sidebar says them. */
export const COHORT_APPLICATION_NOTE = { APPROVED: "Accepted", AUDIT: "Audit", COMPLETED: "Completed" } as const;
export type CohortApplicationStatus = keyof typeof COHORT_APPLICATION_NOTE;

/** A cohort the person belongs to: through their application, or a role in it (instructor, TA, mentor). */
export interface CohortMembership {
  programId: string;
  name: string;
  curriculum: string | null;
  startDate: Date | null;
  endDate: Date | null;
  /** Their application to it, when they were accepted onto it; null for a role alone. */
  application: CohortApplicationStatus | null;
}

/**
 * How the Cohort space names the person's cohort (T07, prototype 02): "Cohort 05", then what it covers
 * and where it is ("Full-stack foundations · week 10 of 17"), and their application, which the sidebar
 * keeps under "Earlier" once they are in.
 */
export interface CohortHeading {
  id: string;
  name: string;
  detail: string | null;
  application: CohortApplicationStatus | null;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** "week 9 of 12" while the cohort runs; nothing before it starts, after it ends, or without both dates. */
export function cohortWeek(startDate: Date | null, endDate: Date | null, now: number): string | null {
  if (!startDate || !endDate) return null;
  const start = startDate.getTime();
  const end = endDate.getTime();
  if (now < start || now > end || end <= start) return null;
  const total = Math.ceil((end - start) / WEEK);
  const week = Math.min(total, Math.floor((now - start) / WEEK) + 1);
  return `week ${week} of ${total}`;
}

/**
 * The cohort to name: the one running now that started last, else the one that started last. Null
 * when the person belongs to none (an admin sees every cohort without being in one), so the space
 * keeps its general name rather than naming a cohort that isn't theirs.
 */
export function chooseCohort(memberships: readonly CohortMembership[], now: number): CohortHeading | null {
  const started = (membership: CohortMembership) => membership.startDate?.getTime() ?? Number.NEGATIVE_INFINITY;
  const byStart = memberships.toSorted((a, b) => started(b) - started(a));
  const chosen = byStart.find((membership) => cohortWeek(membership.startDate, membership.endDate, now) !== null) ?? byStart[0];
  if (!chosen) return null;
  const detail = [chosen.curriculum?.trim() || null, cohortWeek(chosen.startDate, chosen.endDate, now)].filter(Boolean).join(" · ");
  return { id: chosen.programId, name: chosen.name.trim() || "Cohort", detail: detail || null, application: chosen.application };
}

/**
 * Search's cohort scope covers every cohort the person reads, so it names one only when there is
 * just the one ("Cohort 05"); otherwise it stays "Your cohort".
 */
export function cohortSearchLabel(me: Pick<Me, "capabilities">, heading: CohortHeading | null): string | null {
  const ids = me.capabilities.cohortIds;
  return heading && ids.length === 1 && ids[0] === heading.id ? heading.name : null;
}
