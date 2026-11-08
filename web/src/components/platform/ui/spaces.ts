import { SPACE_ORDER, type SpaceId } from "@/lib/platform/space-order";

/**
 * The platform's spaces, in the order every tab row shows them: a person sees only the spaces their
 * roles open, but always in this order, with Profile last. It is SPACE_ORDER itself, from the zod-free
 * space-order.ts, so a client island using the primitives never loads zod or the contract module.
 */
export const SPACES = SPACE_ORDER;

export type Space = SpaceId;
