import type { SpaceId } from "@/lib/platform/contracts";

/**
 * The platform's spaces, in the order every tab row shows them: a person sees
 * only the spaces their roles open, but always in this order, with Profile
 * last. This is the contract's `SPACE_ORDER`, restated so that a client island
 * using the primitives does not pull zod and the whole contract module into its
 * bundle; `satisfies` and SpaceFile.test.tsx keep the two identical.
 */
export const SPACES = [
  "cohort",
  "community",
  "mentoring",
  "discover",
  "admin",
  "profile",
] as const satisfies readonly SpaceId[];

export type Space = SpaceId;
