import { desc, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { GOOGLE_DRIVE_PROVIDER } from "@/lib/credentials/google-drive";

/*
 * The admin's integrations page: the stored Google Drive credential's public
 * facts, who changed it last, and what happened to it recently, each with the
 * person's name joined in SQL rather than read one person at a time.
 */

export const INTEGRATIONS_PATH = "/admin/settings/integrations";
export const RECENT_ACTIVITY = 10;

export type CredentialAction = (typeof schema.credentialAuditLog.action.enumValues)[number];

/** What happened, in words: "Saved", "Tested". */
export const CREDENTIAL_ACTION_LABEL: Record<CredentialAction, string> = {
  set: "Saved",
  replace: "Replaced",
  "update-config": "Impersonated user changed",
  remove: "Removed",
  test: "Tested",
};

interface CredentialFacts {
  clientEmail?: string;
  projectId?: string;
  privateKeyIdFingerprint?: string;
}

/** Stored JSON read leniently: a value that isn't an object reads as none. */
function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** The credential's facts and recent activity, read together in one round trip. */
export async function readIntegrationsPage(db: Database) {
  const credential = schema.integrationCredential;
  const audit = schema.credentialAuditLog;
  const [[stored], activity] = await Promise.all([
    db
      .select({
        displayMetadata: credential.displayMetadata,
        config: credential.config,
        updatedAt: credential.updatedAt,
        updatedByName: schema.user.name,
      })
      .from(credential)
      .leftJoin(schema.user, eq(schema.user.id, credential.updatedByUserId))
      .where(eq(credential.provider, GOOGLE_DRIVE_PROVIDER))
      .limit(1),
    db
      .select({
        id: audit.id,
        action: audit.action,
        outcome: audit.outcome,
        actorName: schema.user.name,
        createdAt: audit.createdAt,
      })
      .from(audit)
      .leftJoin(schema.user, eq(schema.user.id, audit.actorUserId))
      .where(eq(audit.provider, GOOGLE_DRIVE_PROVIDER))
      .orderBy(desc(audit.createdAt), desc(audit.id))
      .limit(RECENT_ACTIVITY),
  ]);

  const facts = parseObject(stored?.displayMetadata ?? null);
  const settings = parseObject(stored?.config ?? null);
  return {
    credential: stored
      ? {
          facts: {
            clientEmail: text(facts.clientEmail),
            projectId: text(facts.projectId),
            privateKeyIdFingerprint: text(facts.privateKeyIdFingerprint),
          } satisfies CredentialFacts,
          impersonatedUser: text(settings.impersonatedUser),
          updatedAt: stored.updatedAt,
          updatedByName: stored.updatedByName,
        }
      : null,
    activity: activity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      outcome: entry.outcome,
      // Every change records who made it; an account deleted since leaves no name (ON DELETE SET NULL).
      by: entry.actorName ?? "Not recorded",
      createdAt: entry.createdAt,
    })),
  };
}
