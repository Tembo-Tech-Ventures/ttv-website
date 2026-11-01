import { isAgentSession } from "@/lib/agent-auth";
import type { StagingFixtureIdentity } from "@/lib/staging-fixtures";
import { CommunityError } from "./model";

/** Who is calling the community API, as /api/community/[...path] sees them. */
export interface CommunityActor {
  id: string;
  scopes: readonly string[] | null;
  delegatedSession?: boolean;
  demo?: { persona: string } | null;
  fixture?: StagingFixtureIdentity | null;
}

/** The request's community actor, or null when nobody is signed in. */
export function communityActor(
  locals: Pick<App.Locals, "user" | "session" | "personalAccessToken" | "stagingDemo" | "stagingFixture">,
): CommunityActor | null {
  if (!locals.user) return null;
  return {
    id: locals.user.id,
    demo: locals.stagingDemo,
    fixture: locals.stagingFixture,
    delegatedSession: isAgentSession(locals.session?.userAgent),
    scopes: locals.personalAccessToken?.scopes ?? null,
  };
}

/**
 * Access management and mentor review are browser-only: personal access
 * tokens and delegated agent sessions are refused, except the synthetic
 * mentor and admin personas those journeys are tested with.
 */
export function requireBrowser(actor: CommunityActor, admin = false) {
  if (actor.scopes !== null) throw new CommunityError("Use a browser session to manage access or review mentorship.",403);
  if (!actor.delegatedSession) return;
  if (!admin && actor.demo?.persona === "mentor") return;
  const personas = admin ? ["admin"] : ["mentor","admin"];
  if (actor.fixture && personas.includes(actor.fixture.persona)) return;
  throw new CommunityError("Use a browser session to manage access or review mentorship.",403);
}
