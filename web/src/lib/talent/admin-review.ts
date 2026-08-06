import {
  canTransition,
  PROFILE_TRANSITIONS,
  PROJECT_TRANSITIONS,
} from "./transitions";

const PROFILE_STATUS_ORDER: Record<string, number> = {
  IN_REVIEW: 0,
  DRAFT: 1,
  PUBLISHED: 2,
  SUSPENDED: 3,
};

interface ProfileSortable {
  status: string;
  updatedAt: Date | null;
}

export function sortProfilesForQueue<T extends ProfileSortable>(
  profiles: T[]
): T[] {
  return [...profiles].sort((a, b) => {
    const aOrder = PROFILE_STATUS_ORDER[a.status] ?? 99;
    const bOrder = PROFILE_STATUS_ORDER[b.status] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aTime = a.updatedAt?.getTime() ?? 0;
    const bTime = b.updatedAt?.getTime() ?? 0;
    return bTime - aTime;
  });
}

const PROJECT_STATUS_ORDER: Record<string, number> = {
  PENDING: 0,
  APPROVED: 1,
  MATCHED: 2,
  REJECTED: 3,
  CLOSED: 4,
};

interface ProjectSortable {
  status: string;
  createdAt: Date | null;
}

export function sortProjectsForQueue<T extends ProjectSortable>(
  projects: T[]
): T[] {
  return [...projects].sort((a, b) => {
    const aOrder = PROJECT_STATUS_ORDER[a.status] ?? 99;
    const bOrder = PROJECT_STATUS_ORDER[b.status] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aTime = a.createdAt?.getTime() ?? 0;
    const bTime = b.createdAt?.getTime() ?? 0;
    return bTime - aTime;
  });
}

export function validateProfileTransition(
  currentStatus: string,
  newStatus: string
): { valid: true } | { valid: false; reason: string } {
  if (!canTransition(PROFILE_TRANSITIONS, currentStatus, newStatus)) {
    return {
      valid: false,
      reason: `Cannot transition from ${currentStatus} to ${newStatus}`,
    };
  }
  return { valid: true };
}

export function validateProjectTransition(
  currentStatus: string,
  newStatus: string
): { valid: true } | { valid: false; reason: string } {
  if (!canTransition(PROJECT_TRANSITIONS, currentStatus, newStatus)) {
    return {
      valid: false,
      reason: `Cannot transition from ${currentStatus} to ${newStatus}`,
    };
  }
  return { valid: true };
}

export function shouldSetPublishedAt(
  newStatus: string,
  currentPublishedAt: Date | null
): boolean {
  return newStatus === "PUBLISHED" && currentPublishedAt === null;
}

interface InterestRow {
  status: string;
}

export function separateInterests<T extends InterestRow>(
  interests: T[]
): { interested: T[]; withdrawn: T[] } {
  return {
    interested: interests.filter((i) => i.status === "INTERESTED"),
    withdrawn: interests.filter((i) => i.status === "WITHDRAWN"),
  };
}
