import { describe, expect, it, vi } from "vitest";
import type { CredentialCipher } from "./crypto";

vi.mock("@/lib/db/schema", () => ({
  integrationCredential: { provider: "provider" },
  credentialAuditLog: { provider: "provider", createdAt: "createdAt" },
}));

function createMockCipher(opts?: { needsReencrypt?: boolean }): CredentialCipher {
  return {
    encrypt: vi.fn(async (plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn(async (blob: string) => ({
      plaintext: blob.replace(/^(re)?encrypted:/, ""),
      needsReencrypt: opts?.needsReencrypt ?? false,
    })),
  };
}

function createMockDb() {
  const credentials = new Map<
    string,
    {
      provider: string;
      ciphertext: string;
      displayMetadata: string | null;
      config: string | null;
      updatedByUserId: string | null;
      updatedAt: Date;
    }
  >();
  const auditLog: Array<{
    provider: string;
    action: string;
    outcome: string | null;
    actorUserId: string | null;
  }> = [];

  const db = {
    query: {
      integrationCredential: {
        findFirst: vi.fn(async (_opts?: { where?: unknown; columns?: unknown }) => {
          for (const cred of credentials.values()) return cred;
          return undefined;
        }),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        if ("ciphertext" in values) {
          credentials.set(values.provider as string, {
            provider: values.provider as string,
            ciphertext: values.ciphertext as string,
            displayMetadata: (values.displayMetadata as string) ?? null,
            config: (values.config as string) ?? null,
            updatedByUserId: (values.updatedByUserId as string) ?? null,
            updatedAt: new Date(),
          });
          return {
            onConflictDoUpdate: vi.fn(
              ({ set }: { target: unknown; set: Record<string, unknown> }) => {
                const existing = credentials.get(values.provider as string);
                if (existing) {
                  Object.assign(existing, {
                    ciphertext: set.ciphertext ?? existing.ciphertext,
                    displayMetadata: set.displayMetadata ?? existing.displayMetadata,
                    config: set.config ?? existing.config,
                    updatedByUserId: set.updatedByUserId ?? existing.updatedByUserId,
                    updatedAt: new Date(),
                  });
                }
              },
            ),
          };
        }
        if ("action" in values) {
          auditLog.push({
            provider: values.provider as string,
            action: values.action as string,
            outcome: (values.outcome as string) ?? null,
            actorUserId: (values.actorUserId as string) ?? null,
          });
        }
        return { onConflictDoUpdate: vi.fn() };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: Record<string, unknown>) => ({
        where: vi.fn(() => {
          for (const cred of credentials.values()) {
            Object.assign(cred, updates);
          }
          return {
            returning: vi.fn(async () => {
              const result = [...credentials.values()];
              return result.map((c) => ({ id: c.provider }));
            }),
          };
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        credentials.clear();
        return Promise.resolve();
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () =>
              auditLog
                .slice()
                .reverse()
                .map((e) => ({ ...e, createdAt: new Date() })),
            ),
          })),
        })),
      })),
    })),
  };

  return { db: db as never, credentials, auditLog };
}

describe("setIntegrationCredential", async () => {
  const { setIntegrationCredential } = await import("./store");

  it("inserts a new credential and writes a 'set' audit entry", async () => {
    const { db, auditLog } = createMockDb();
    const cipher = createMockCipher();

    await setIntegrationCredential(db, cipher, {
      provider: "google-drive",
      secret: "my-secret",
      displayMetadata: '{"clientEmail":"test@example.com"}',
      actorUserId: "user-1",
    });

    expect(cipher.encrypt).toHaveBeenCalledWith("my-secret", "google-drive");
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe("set");
    expect(auditLog[0].outcome).toContain("saved");
  });

  it("writes a 'replace' audit entry when the credential already exists", async () => {
    const { db, credentials, auditLog } = createMockDb();
    const cipher = createMockCipher();

    credentials.set("google-drive", {
      provider: "google-drive",
      ciphertext: "old",
      displayMetadata: null,
      config: null,
      updatedByUserId: "user-1",
      updatedAt: new Date(),
    });

    await setIntegrationCredential(db, cipher, {
      provider: "google-drive",
      secret: "new-secret",
      actorUserId: "user-2",
    });

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe("replace");
  });
});

describe("getIntegrationCredentialSecret", async () => {
  const { getIntegrationCredentialSecret } = await import("./store");

  it("returns null when no credential is configured", async () => {
    const { db } = createMockDb();
    const cipher = createMockCipher();
    const result = await getIntegrationCredentialSecret(db, cipher, "google-drive");
    expect(result).toBeNull();
  });

  it("returns decrypted secret and config", async () => {
    const { db, credentials } = createMockDb();
    const cipher = createMockCipher();
    credentials.set("google-drive", {
      provider: "google-drive",
      ciphertext: "encrypted:my-secret",
      displayMetadata: null,
      config: '{"impersonatedUser":"user@example.com"}',
      updatedByUserId: "user-1",
      updatedAt: new Date(),
    });

    const result = await getIntegrationCredentialSecret(db, cipher, "google-drive");
    expect(result).toEqual({
      secret: "my-secret",
      config: '{"impersonatedUser":"user@example.com"}',
    });
  });

  it("re-encrypts and persists when needsReencrypt is true", async () => {
    const { db, credentials } = createMockDb();
    const cipher = createMockCipher({ needsReencrypt: true });
    credentials.set("google-drive", {
      provider: "google-drive",
      ciphertext: "encrypted:rotated-secret",
      displayMetadata: null,
      config: null,
      updatedByUserId: "user-1",
      updatedAt: new Date(),
    });

    const result = await getIntegrationCredentialSecret(db, cipher, "google-drive");
    expect(result?.secret).toBe("rotated-secret");
    expect(cipher.encrypt).toHaveBeenCalledWith("rotated-secret", "google-drive");
    expect(db.update).toHaveBeenCalled();
  });
});

describe("getIntegrationCredentialStatus", async () => {
  const { getIntegrationCredentialStatus } = await import("./store");

  it("returns null when no credential exists", async () => {
    const { db } = createMockDb();
    const result = await getIntegrationCredentialStatus(db, "google-drive");
    expect(result).toBeNull();
  });
});

describe("updateIntegrationCredentialConfig", async () => {
  const { updateIntegrationCredentialConfig } = await import("./store");

  it("throws when no credential exists for the provider", async () => {
    const { db } = createMockDb();
    await expect(
      updateIntegrationCredentialConfig(db, {
        provider: "nonexistent",
        config: "{}",
        actorUserId: "user-1",
      }),
    ).rejects.toThrow('No credential found for provider "nonexistent"');
  });
});

describe("deleteIntegrationCredential", async () => {
  const { deleteIntegrationCredential } = await import("./store");

  it("removes the credential and writes an audit entry", async () => {
    const { db, credentials, auditLog } = createMockDb();
    credentials.set("google-drive", {
      provider: "google-drive",
      ciphertext: "encrypted:secret",
      displayMetadata: null,
      config: null,
      updatedByUserId: "user-1",
      updatedAt: new Date(),
    });

    await deleteIntegrationCredential(db, {
      provider: "google-drive",
      actorUserId: "user-1",
    });

    expect(credentials.size).toBe(0);
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe("remove");
  });
});

describe("recordCredentialTest", async () => {
  const { recordCredentialTest } = await import("./store");

  it("writes a pass audit entry", async () => {
    const { db, auditLog } = createMockDb();
    await recordCredentialTest(db, {
      provider: "google-drive",
      actorUserId: "user-1",
      ok: true,
      detail: "Listed 3 folders",
    });

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe("test");
    expect(auditLog[0].outcome).toBe("Pass: Listed 3 folders");
  });

  it("writes a fail audit entry", async () => {
    const { db, auditLog } = createMockDb();
    await recordCredentialTest(db, {
      provider: "google-drive",
      actorUserId: "user-1",
      ok: false,
      detail: "Authentication failed",
    });

    expect(auditLog[0].outcome).toBe("Fail: Authentication failed");
  });
});

describe("getRecentAuditEntries", async () => {
  const { getRecentAuditEntries } = await import("./store");

  it("returns recent audit entries for a provider", async () => {
    const { db, auditLog } = createMockDb();
    auditLog.push({
      provider: "google-drive",
      action: "set",
      outcome: "Credential saved.",
      actorUserId: "user-1",
    });

    const entries = await getRecentAuditEntries(db, "google-drive");
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("set");
  });
});
