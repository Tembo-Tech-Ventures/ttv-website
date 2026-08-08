import { eq, desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import type { CredentialCipher } from "./crypto";

export async function setIntegrationCredential(
  db: Database,
  cipher: CredentialCipher,
  options: {
    provider: string;
    secret: string;
    config?: string;
    displayMetadata?: string;
    actorUserId: string;
  },
) {
  const existing = await db.query.integrationCredential.findFirst({
    where: eq(schema.integrationCredential.provider, options.provider),
  });
  const action = existing ? "replace" : "set";

  const ciphertext = await cipher.encrypt(options.secret, options.provider);

  await db
    .insert(schema.integrationCredential)
    .values({
      provider: options.provider,
      ciphertext,
      displayMetadata: options.displayMetadata ?? null,
      config: options.config ?? null,
      updatedByUserId: options.actorUserId,
    })
    .onConflictDoUpdate({
      target: schema.integrationCredential.provider,
      set: {
        ciphertext,
        displayMetadata: options.displayMetadata ?? null,
        config: options.config ?? null,
        updatedByUserId: options.actorUserId,
        updatedAt: new Date(),
      },
    });

  await db.insert(schema.credentialAuditLog).values({
    provider: options.provider,
    action,
    outcome: `Credential ${action === "set" ? "saved" : "replaced"}.`,
    actorUserId: options.actorUserId,
  });
}

export async function updateIntegrationCredentialConfig(
  db: Database,
  options: {
    provider: string;
    config: string;
    actorUserId: string;
  },
) {
  const result = await db
    .update(schema.integrationCredential)
    .set({
      config: options.config,
      updatedByUserId: options.actorUserId,
      updatedAt: new Date(),
    })
    .where(eq(schema.integrationCredential.provider, options.provider))
    .returning({ id: schema.integrationCredential.id });

  if (result.length === 0) {
    throw new Error(`No credential found for provider "${options.provider}".`);
  }

  await db.insert(schema.credentialAuditLog).values({
    provider: options.provider,
    action: "update-config",
    outcome: "Configuration updated.",
    actorUserId: options.actorUserId,
  });
}

export async function getIntegrationCredentialSecret(
  db: Database,
  cipher: CredentialCipher,
  provider: string,
): Promise<{ secret: string; config: string | null } | null> {
  const row = await db.query.integrationCredential.findFirst({
    where: eq(schema.integrationCredential.provider, provider),
  });
  if (!row) return null;

  const { plaintext, needsReencrypt } = await cipher.decrypt(
    row.ciphertext,
    provider,
  );

  if (needsReencrypt) {
    const newCiphertext = await cipher.encrypt(plaintext, provider);
    await db
      .update(schema.integrationCredential)
      .set({ ciphertext: newCiphertext, updatedAt: new Date() })
      .where(eq(schema.integrationCredential.provider, provider));
  }

  return { secret: plaintext, config: row.config };
}

export async function getIntegrationCredentialStatus(
  db: Database,
  provider: string,
): Promise<{
  configured: boolean;
  displayMetadata: string | null;
  config: string | null;
  updatedAt: Date;
  updatedBy: string | null;
} | null> {
  const row = await db.query.integrationCredential.findFirst({
    where: eq(schema.integrationCredential.provider, provider),
    columns: {
      displayMetadata: true,
      config: true,
      updatedAt: true,
      updatedByUserId: true,
    },
  });
  if (!row) return null;

  return {
    configured: true,
    displayMetadata: row.displayMetadata,
    config: row.config,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedByUserId,
  };
}

export async function deleteIntegrationCredential(
  db: Database,
  options: {
    provider: string;
    actorUserId: string;
  },
) {
  await db
    .delete(schema.integrationCredential)
    .where(eq(schema.integrationCredential.provider, options.provider));

  await db.insert(schema.credentialAuditLog).values({
    provider: options.provider,
    action: "remove",
    outcome: "Credential removed.",
    actorUserId: options.actorUserId,
  });
}

export async function recordCredentialTest(
  db: Database,
  options: {
    provider: string;
    actorUserId: string;
    ok: boolean;
    detail: string;
  },
) {
  await db.insert(schema.credentialAuditLog).values({
    provider: options.provider,
    action: "test",
    outcome: options.ok ? `Pass: ${options.detail}` : `Fail: ${options.detail}`,
    actorUserId: options.actorUserId,
  });
}

export async function getRecentAuditEntries(
  db: Database,
  provider: string,
  limit = 10,
) {
  return db
    .select({
      action: schema.credentialAuditLog.action,
      outcome: schema.credentialAuditLog.outcome,
      actorUserId: schema.credentialAuditLog.actorUserId,
      createdAt: schema.credentialAuditLog.createdAt,
    })
    .from(schema.credentialAuditLog)
    .where(eq(schema.credentialAuditLog.provider, provider))
    .orderBy(desc(schema.credentialAuditLog.createdAt))
    .limit(limit);
}
