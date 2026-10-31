import { SPACE_ORDER, SpaceId } from "../contracts";

export const LAST_SPACE_COOKIE = "ttv-last-space";
export const LAST_SPACE_MAX_AGE = 31_536_000;

/** Pure server/client selection. Pass current Me.spaces; never infer authority from a cookie. */
export function selectDefaultSpace(
  spaces: readonly SpaceId[],
  { explicitSpace, lastSpace }: { explicitSpace?: unknown; lastSpace?: unknown } = {},
): SpaceId | null {
  for (const candidate of [explicitSpace, lastSpace]) {
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
