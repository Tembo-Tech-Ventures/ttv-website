import { meByPersona } from "../fixtures";
import { createSpacesController, type SpacesOptions } from "./spaces";

/** Harness-only fixture mode; keep this module out of production island imports. */
export function createMockSpacesController(
  persona: keyof typeof meByPersona,
  options: Pick<SpacesOptions, "explicitSpace" | "lastSpace"> = {},
) {
  return createSpacesController({ ...options, me: meByPersona[persona], browser: null });
}
