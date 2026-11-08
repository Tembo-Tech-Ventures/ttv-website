import type * as schema from "@/lib/db/schema";

type ApplicationStatus = (typeof schema.programApplication.status.enumValues)[number];

/**
 * What the applications list says when a status filter shows nothing: in the
 * status's own words, and only what is true of it. An application in review
 * has not been decided, so that view never says one was.
 */
export function emptyFilterCopy(status: ApplicationStatus): { title: string; body: string } {
  switch (status) {
    case "PENDING":
      return { title: "No applications in review", body: "No one is waiting for a decision." };
    case "APPROVED":
      return { title: "No accepted applications", body: "Applications move here when an administrator accepts them." };
    case "REJECTED":
      return { title: "No declined applications", body: "Applications move here when an administrator declines them." };
    case "AUDIT":
      return { title: "No applications in audit", body: "Applications move here when an administrator moves them to audit." };
    case "COMPLETED":
      return { title: "No completed applications", body: "Applications move here when an administrator marks them completed." };
  }
}
