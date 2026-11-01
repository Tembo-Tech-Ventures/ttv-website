import { type Intent, SPACE_ORDER, SpaceId } from "../contracts";

export const LAST_SPACE_COOKIE = "ttv-last-space";
export const LAST_SPACE_MAX_AGE = 31_536_000;

/** The space each intent leads to once its role is granted, in onboarding precedence (SPEC §3). */
const INTENT_SPACES = [["MENTOR", "mentoring"], ["INSTITUTION", "discover"], ["MEMBER", "cohort"]] as const;

/**
 * Where a person's chosen (or inferred) intents point, among the spaces they hold now. Intents never
 * grant: an intent whose space isn't in `spaces` is skipped, and anything else falls to Community.
 * No intents at all is no preference (null), so legacy accounts keep the SPACE_ORDER default.
 */
export function preferredSpace(intents: readonly Intent[], spaces: readonly SpaceId[]): SpaceId | null {
  if (intents.length === 0) return null;
  const preferred = INTENT_SPACES.find(([intent, space]) => intents.includes(intent) && spaces.includes(space));
  if (preferred) return preferred[1];
  return spaces.includes("community") ? "community" : null;
}

/**
 * Pure server/client selection: explicit URL, then cookie, then `preferred`, then SPACE_ORDER.
 * Pass current Me.spaces; never infer authority from a cookie or an intent.
 */
export function selectDefaultSpace(
  spaces: readonly SpaceId[],
  { explicitSpace, lastSpace, preferred }: { explicitSpace?: unknown; lastSpace?: unknown; preferred?: unknown } = {},
): SpaceId | null {
  for (const candidate of [explicitSpace, lastSpace, preferred]) {
    const parsed = SpaceId.safeParse(candidate);
    if (parsed.success && spaces.includes(parsed.data)) return parsed.data;
  }
  return SPACE_ORDER.find(space => spaces.includes(space)) ?? null;
}

/** The cookie is a plain enum string. Do not URL-decode or JSON-parse it. */
export function readLastSpaceCookie(header: string | null | undefined): SpaceId | null {
  const values = (header ?? "").split(";").map(part => part.trim())
    .filter(part => part.startsWith(`${LAST_SPACE_COOKIE}=`))
    .map(part => part.slice(LAST_SPACE_COOKIE.length + 1));
  // Ambiguous cookies can result from an old, differently scoped preference.
  if (values.length !== 1) return null;
  const parsed = SpaceId.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}

export function serializeLastSpaceCookie(space: SpaceId, secure: boolean): string {
  return `${LAST_SPACE_COOKIE}=${SpaceId.parse(space)}; Path=/dashboard; SameSite=Lax; Max-Age=${LAST_SPACE_MAX_AGE}${secure ? "; Secure" : ""}`;
}
