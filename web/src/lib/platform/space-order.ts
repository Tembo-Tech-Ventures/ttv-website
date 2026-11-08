/**
 * The platform's spaces, in the order every tab row shows them, with the checks client islands need.
 * Zod-free on purpose: contracts.ts builds `SpaceId` and `Me`'s ordering rule from these, and an
 * island that only needs the list or a guard never loads zod and the contract module (S6).
 */
export const SPACE_ORDER = ["cohort", "community", "mentoring", "discover", "admin", "profile"] as const;
export type SpaceId = (typeof SPACE_ORDER)[number];

export function isSpaceId(value: unknown): value is SpaceId {
  return typeof value === "string" && (SPACE_ORDER as readonly string[]).includes(value);
}

/** Every entry a space, each once, in SPACE_ORDER: the shape `Me.spaces` always has. */
export function inSpaceOrder(spaces: readonly unknown[]): spaces is readonly SpaceId[] {
  return spaces.every((space, index) => isSpaceId(space)
    && (index === 0 || SPACE_ORDER.indexOf(spaces[index - 1] as SpaceId) < SPACE_ORDER.indexOf(space)));
}
