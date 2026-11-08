/*
 * The words and decisions of a cohort's admin page (/admin/programs/[id]):
 * what each change says afterwards, how a staff role reads, and which changes
 * ask first. Statuses are said in words ("accepted"), never as stored
 * ("APPROVED").
 */

export const COHORTS_PATH = "/admin/programs";

/** The page's forms, so a rejected one shows its problem at the top of its own section. */
/** What a form says when the database, not the request, failed (503): nothing changed, try again. */
export const STORE_UNAVAILABLE = "The database didn't answer, so nothing changed. Try again in a moment.";

export type CohortForm = "details" | "staff" | "mentors" | "enrol" | "roster";

/** A cohort staff or mentor role, as the page says it. */
export function cohortRoleLabel(name: string): string {
  if (name === "TA") return "Teaching assistant";
  if (name === "INSTRUCTOR") return "Instructor";
  if (name === "MENTOR") return "Mentor";
  return name.charAt(0) + name.slice(1).toLowerCase();
}

/** The staff roles an administrator can give here; mentors have their own section. */
export const STAFF_ROLE_OPTIONS = [
  { value: "INSTRUCTOR", label: "Instructor" },
  { value: "TA", label: "Teaching assistant" },
] as const;

/** How someone joins the roster directly, in words: a current learner, or a past one whose certificate opens. */
export const ENROLMENT_STATUS_OPTIONS = [
  { value: "APPROVED", label: "Accepted: a current learner" },
  { value: "COMPLETED", label: "Completed: a past learner" },
] as const;

/** What a change says once its page loads again. */
export function cohortChangeNotice(change:
  | { kind: "details" | "staff-added" | "staff-removed" | "mentor-added" | "mentor-removed" }
  | { kind: "enrolled"; status: "APPROVED" | "COMPLETED" }
  | { kind: "bulk"; action: "bulk-approve" | "bulk-complete"; count: number }): string {
  switch (change.kind) {
    case "details":
      return "Cohort details saved.";
    case "staff-added":
      return "Added to the cohort's staff.";
    case "staff-removed":
      return "Removed from the cohort's staff.";
    case "mentor-added":
      return "Mentor added. They can open this cohort's recordings and channels now.";
    case "mentor-removed":
      return "Mentor removed. Their mentor access to this cohort has ended.";
    case "enrolled":
      return change.status === "COMPLETED"
        ? "Enrolled as a past learner. Their certificate and builder portfolio are open now."
        : "Enrolled as a current learner.";
    case "bulk": {
      const applications = `${change.count} ${change.count === 1 ? "application" : "applications"}`;
      return change.action === "bulk-complete"
        ? `${applications} completed. Their certificates and builder portfolios are open now.`
        : `${applications} accepted.`;
    }
  }
}

/**
 * Completing someone opens their certificate and builder portfolio at once and
 * cannot be quietly taken back, so it asks first; approving does not. The
 * question is asked by the server, so it holds without JavaScript.
 */
export function needsCompletionConfirmation(form: FormData, status: string | null): boolean {
  return status === "COMPLETED" && form.get("confirmed") !== "yes";
}
