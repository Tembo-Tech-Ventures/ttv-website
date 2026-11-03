import { env } from "cloudflare:workers";
import { demoEnabled } from "@/lib/staging-demo-policy";
import { isAgentAuthEnabled } from "@/lib/agent-auth";
import { isLegacyImportEnabled } from "@/lib/admin/import";
import { countPendingAccessRequests } from "@/lib/admin/access-requests";
import { countPendingModeration } from "@/lib/channels/moderation/queue";
import { countOpenChecks } from "@/lib/mentoring/checks";
import { isFlagEnabled } from "@/lib/platform/server/flags";
import type { AdminNavFacts } from "./admin-nav";

/** Counts a page has already read, so the navigation does not read them again. */
export interface AdminNavCounts {
  pendingAccessRequests?: number;
  /** The moderation page (channels on) already holds its waiting count. */
  pendingModeration?: number;
  /** Open checks on request notes, when the page already counted them. */
  pendingRequestNotes?: number;
}

/**
 * What the admin navigation shows for this administrator: which optional tools exist here, and
 * the counts beside Access requests and Moderation. No Moderation entry (null) while `channels` is
 * off for them: there is no queue to link to. Its badge also counts the open request-note checks
 * this admin may decide while `mentor_requests` is on (QA4-04), which the Request notes tab lists.
 */
export async function loadAdminNavFacts(locals: App.Locals, origin: string, counts: AdminNavCounts = {}): Promise<AdminNavFacts & { pendingCases: number | null; pendingRequestNotes: number }> {
  const viewerId = locals.user?.id ?? "";
  const flagContext = { db: env.DB, env, user: locals.user ?? null, isAdmin: true, locals };
  const channelsOn = counts.pendingModeration !== undefined || await isFlagEnabled(flagContext, "channels");
  const [pendingAccessRequests, [pendingModeration, pendingRequestNotes]] = await Promise.all([
    counts.pendingAccessRequests ?? countPendingAccessRequests(env.DB),
    channelsOn
      ? Promise.all([
        counts.pendingModeration ?? countPendingModeration(env.DB, viewerId),
        counts.pendingRequestNotes ?? (isFlagEnabled(flagContext, "mentor_requests").then((on) => on ? countOpenChecks(env.DB, viewerId) : 0)),
      ])
      : Promise.resolve([null, 0] as const),
  ]);
  return {
    agentAuthEnabled: isAgentAuthEnabled(env.AGENT_AUTH_ENABLED),
    stagingDemoEnabled: demoEnabled(env.DEPLOYMENT_ENVIRONMENT, env.STAGING_DEMO_ENABLED, origin),
    dataMigrationEnabled: isLegacyImportEnabled(env.DEPLOYMENT_ENVIRONMENT),
    pendingAccessRequests,
    // The queue's count is the message cases' alone (the in-place swap reports it); request notes are added.
    pendingModeration: pendingModeration === null ? null : pendingModeration + pendingRequestNotes,
    // Separately too, for the existing admin shell, which adds them itself as the queue swaps in place.
    pendingCases: pendingModeration,
    pendingRequestNotes,
  };
}
