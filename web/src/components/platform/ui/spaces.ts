/**
 * The platform's spaces, in the order every tab row shows them: a person sees
 * only the spaces their roles open, but always in this order, with Profile
 * last (PLAN.md, "One app, a few spaces").
 */
export const SPACES = [
  "cohort",
  "community",
  "mentoring",
  "discover",
  "admin",
  "profile",
] as const;

export type Space = (typeof SPACES)[number];

