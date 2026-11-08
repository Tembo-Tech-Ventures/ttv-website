import { AGENT_SESSION_DURATIONS, type AgentSessionSummary } from "@/lib/agent-auth";

/*
 * How the admin's agent access page words a session: how long one lasts,
 * whether it still works, and the confirm step that ends it.
 */

export const AGENT_ACCESS_PATH = "/admin/agent-access";

/** A lifetime in words: "1 hour", "8 hours", "7 days". */
export function agentLifetimeLabel(hours: number): string {
  if (hours % 24 === 0 && hours >= 48) return `${hours / 24} days`;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** The form's lifetimes, shortest first; 8 hours is the default. */
export const AGENT_LIFETIME_OPTIONS = AGENT_SESSION_DURATIONS.map((hours) => ({ value: String(hours), label: agentLifetimeLabel(hours) }));
export const DEFAULT_AGENT_LIFETIME = "8";

/** Whether a session still works. Revoking one deletes it, so there is no revoked state. */
export function agentSessionStatus(session: Pick<AgentSessionSummary, "expiresAt">, now: Date): "ACTIVE" | "EXPIRED" {
  return session.expiresAt <= now ? "EXPIRED" : "ACTIVE";
}

/** The confirm step's action for revoking one session. */
export function revokeSessionAction(sessionId: string): string {
  return `revoke-${sessionId}`;
}
