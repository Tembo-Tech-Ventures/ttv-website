import type { RoleBadge } from "@/lib/platform/contracts";

/**
 * The harness draws the mission's shared fictional people (B-0.1 fixtures), so
 * the primitives are judged with the same names and server-shaped role badges
 * the spaces screens will receive.
 */
export { people as PEOPLE, temboAuthor as TEMBO } from "@/lib/platform/fixtures";

/** One badge of every kind, worded as the server words them. */
export const EVERY_ROLE: RoleBadge[] = [
  { kind: "COHORT", label: "Cohort 04", programId: null },
  { kind: "ALUMNI", label: "Alumni · Cohort 02", programId: null },
  { kind: "COMMUNITY", label: "Community", programId: null },
  { kind: "MENTOR", label: "Mentor", programId: null },
  { kind: "TA", label: "TA", programId: null },
  { kind: "INSTRUCTOR", label: "Instructor", programId: null },
  { kind: "INSTITUTION", label: "Institution partner", programId: null },
  { kind: "STAFF", label: "Staff", programId: null },
  { kind: "ADMIN", label: "Admin", programId: null },
  { kind: "AI", label: "AI", programId: null },
];

/** A stand-in photo: an abstract portrait, so no real face is ever used. */
export const SAMPLE_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2C6964"/><stop offset="1" stop-color="#013D39"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="25" r="11" fill="#F7B08F"/><path d="M12 64c2-14 10-21 20-21s18 7 20 21z" fill="#F28D68"/></svg>`,
)}`;
