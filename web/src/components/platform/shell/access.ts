import type { Me, SpaceId } from "@/lib/platform/contracts";

/**
 * Whether the spaces shell may render `space` for this person: the `spaces`
 * flag is on for them and their roles open that space. With the flag off the
 * shell does not exist, so the existing dashboard stays exactly as it is.
 *
 * This is a display guard. Route guards and APIs still authorise every request.
 */
export function canRenderSpace(me: Me | null | undefined, space: SpaceId): me is Me {
  return me?.flags.spaces === true && me.spaces.includes(space);
}
