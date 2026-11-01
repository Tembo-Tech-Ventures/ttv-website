import { isAgentSession } from "@/lib/agent-auth";
import { getFirstName } from "@/lib/display-name";
import {
  AccessDecisionKind, AccessRole, DecisionMessage, Id,
  type AccessDecision, type AdminAccessRequest,
} from "@/lib/platform/contracts";
import { OnboardingError } from "@/lib/onboarding/service";

/**
 * The admin side of access requests (onboarding SPEC S6): the queue at /admin/access-requests, the
 * sidebar count, and the mentor and institution controls on /admin/users/[id]. The decisions
 * themselves are lib/onboarding/decisions.ts; this module turns forms into its inputs and its
 * outcomes into the words an administrator reads.
 */

export const ACCESS_REQUESTS_PATH = "/admin/access-requests";

export const ACCESS_ROLE_LABELS: Record<AccessRole, string> = { MENTOR: "Mentor", INSTITUTION: "Institution" };

/**
 * Request notes are for human administrators, and no agent grants roles (SPEC §5), so personal
 * access tokens and agent sessions are refused here as they are on /api/admin/access-requests.
 */
export function isDelegatedCredential(locals: Pick<App.Locals, "personalAccessToken" | "session">): boolean {
  return Boolean(locals.personalAccessToken) || isAgentSession(locals.session?.userAgent);
}

/**
 * The open-request count for the Admin sidebar. A badge must never take an admin page down with it,
 * so a failed read shows no badge instead.
 */
export async function countPendingAccessRequests(db: D1Database): Promise<number> {
  try {
    const row = await db.prepare("SELECT count(*) AS count FROM access_request WHERE status = 'PENDING'")
      .first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    console.warn("The access request count could not be read.");
    return 0;
  }
}

/** The name the queue writes to someone in: "Message to Mercy". */
export function addressName(name: string): string {
  return getFirstName(name) ?? "them";
}

export type DecisionForm =
  | { ok: true; id: string; decision: AccessDecision }
  | { ok: false; id: string | null; error: string };

const MESSAGE_TOO_LONG = "Keep the message to 600 characters or fewer.";

/**
 * One request's form: its id, the button pressed and the optional message. The message travels
 * only with a decline: an approved person sees "Mentoring is open", never a note, so a message
 * typed before pressing Approve would reach no one.
 */
export function parseDecisionForm(form: FormData): DecisionForm {
  const id = Id.safeParse(form.get("id")).data ?? null;
  const decision = AccessDecisionKind.safeParse(form.get("decision")).data;
  if (!id || !decision) return { ok: false, id, error: "Choose Approve or Decline for a request in the list." };
  if (decision === "approve") return { ok: true, id, decision: { decision } };

  const raw = form.get("message");
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: true, id, decision: { decision } };
  const message = DecisionMessage.safeParse(text);
  return message.success ? { ok: true, id, decision: { decision, message: message.data } } : { ok: false, id, error: MESSAGE_TOO_LONG };
}

export interface DecisionFailure {
  status: 400 | 404 | 409;
  message: string;
}

/** Copy for a decision the domain refused. Anything else is unexpected and propagates. */
export function decisionFailure(error: unknown): DecisionFailure | null {
  if (!(error instanceof OnboardingError)) return null;
  if (error.code === "conflict") {
    return {
      status: 409,
      message: "Someone already decided this request, or the person withdrew it, so nothing changed. The list below is up to date.",
    };
  }
  if (error.code === "not_found") {
    return { status: 404, message: "This request no longer exists. The account may have been deleted." };
  }
  return null;
}

/** What the administrator reads after deciding. Never names who decided: that is them. */
export function decisionNotice(request: Pick<AdminAccessRequest, "role" | "status" | "decisionMessage" | "requester">): string | null {
  const name = request.requester.name;
  const first = addressName(name);
  if (request.status === "APPROVED") {
    return `Approved. ${name} now has ${ACCESS_ROLE_LABELS[request.role].toLowerCase()} access.`;
  }
  if (request.status === "DECLINED") {
    return request.decisionMessage
      ? `Declined. ${first} will see your message, not your name.`
      : `Declined. ${first} stays a member and can send a new request later.`;
  }
  return null;
}

/** A GitHub profile link, only for a login GitHub itself would accept. */
export function githubProfileUrl(login: string | null): string | null {
  return login && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login) ? `https://github.com/${login}` : null;
}

/** A link written the short way people read it: "github.com/mercy-w". */
export function displayLink(href: string): string {
  const url = new URL(href);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const text = `${url.host.replace(/^www\./, "")}${path}`;
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

export type CommunityRoleAction = { kind: "grant" | "revoke"; role: AccessRole };

/** The mentor and institution buttons on /admin/users/[id]: "grant-MENTOR", "revoke-INSTITUTION". */
export function parseCommunityRoleAction(action: FormDataEntryValue | null): CommunityRoleAction | null {
  const match = typeof action === "string" ? /^(grant|revoke)-(MENTOR|INSTITUTION)$/.exec(action) : null;
  if (!match) return null;
  return { kind: match[1] as CommunityRoleAction["kind"], role: AccessRole.parse(match[2]) };
}

const COMMUNITY_ROLE_OUTCOMES = { granted: "given", revoked: "removed" } as const;

/** Where a mentor or institution change lands: back on the user page, at its section, saying what changed. */
export function communityRoleRedirect(userId: string, action: CommunityRoleAction): string {
  const query = new URLSearchParams({ access: action.kind === "grant" ? "granted" : "revoked", accessRole: action.role });
  return `/admin/users/${encodeURIComponent(userId)}?${query}#community-access`;
}

/** The notice after a mentor or institution change, read back from the redirect's query. */
export function communityRoleNotice(outcome: string | null, role: string | null): string | null {
  const parsed = AccessRole.safeParse(role);
  if (!parsed.success || (outcome !== "granted" && outcome !== "revoked")) return null;
  return `${ACCESS_ROLE_LABELS[parsed.data]} access was ${COMMUNITY_ROLE_OUTCOMES[outcome]}.`;
}
