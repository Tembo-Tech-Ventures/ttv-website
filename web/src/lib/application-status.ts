export const applicationStatuses = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "AUDIT",
  "COMPLETED",
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];
export type ApplicationBadgeVariant =
  "pending" | "approved" | "rejected" | "audit" | "completed";

const knownStatuses: ReadonlySet<string> = new Set(applicationStatuses);

const badgeVariantByStatus: Record<ApplicationStatus, ApplicationBadgeVariant> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  AUDIT: "audit",
  COMPLETED: "completed",
};

export function isApplicationStatus(value: string | null): value is ApplicationStatus {
  return value !== null && knownStatuses.has(value);
}

export function applicationBadgeVariant(
  status: ApplicationStatus
): ApplicationBadgeVariant {
  return badgeVariantByStatus[status];
}
