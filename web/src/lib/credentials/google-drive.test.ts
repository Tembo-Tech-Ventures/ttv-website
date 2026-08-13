import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/schema";
import type { CredentialCipher } from "./crypto";
import {
  saveGoogleDriveCredential,
  getGoogleDriveCredentials,
} from "./google-drive";

function generateTestRsaKey(): { privateKeyPem: string; privateKeyId: string } {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    privateKeyPem: privateKey,
    privateKeyId: "test-key-id-12345",
  };
}

function createServiceAccountJson(
  overrides: Record<string, unknown> = {}
): string {
  const { privateKeyPem, privateKeyId } = generateTestRsaKey();
  return JSON.stringify({
    type: "service_account",
    project_id: "test-project",
    private_key_id: privateKeyId,
    private_key: privateKeyPem,
    client_email: "test@test-project.iam.gserviceaccount.com",
    client_id: "123456789",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    ...overrides,
  });
}

interface MockStore {
  credential: { ciphertext: string; config: string | null; displayMetadata: string | null } | null;
  auditLog: Array<{ action: string; outcome: string | null }>;
}

function createMockDb(store: MockStore) {
  return {
    query: {
      integrationCredential: {
        findFirst: vi.fn(async () => {
          if (!store.credential) return undefined;
          return {
            id: "cred-1",
            provider: "google-drive",
            ciphertext: store.credential.ciphertext,
            displayMetadata: store.credential.displayMetadata,
            config: store.credential.config,
            updatedByUserId: "user-1",
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        if (values.ciphertext) {
          store.credential = {
            ciphertext: values.ciphertext as string,
            config: (values.config as string) ?? null,
            displayMetadata: (values.displayMetadata as string) ?? null,
          };
        } else if (values.action) {
          store.auditLog.push({
            action: values.action as string,
            outcome: (values.outcome as string) ?? null,
          });
        }
        return {
          onConflictDoUpdate: vi.fn(({ set }: { target: unknown; set?: Record<string, unknown> }) => {
            if (set?.ciphertext) {
              store.credential = {
                ciphertext: set.ciphertext as string,
                config: (set.config as string) ?? store.credential?.config ?? null,
                displayMetadata: (set.displayMetadata as string) ?? store.credential?.displayMetadata ?? null,
              };
            }
            return Promise.resolve();
          }),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  } as unknown as Database;
}

function createMockCipher(): CredentialCipher {
  return {
    encrypt: vi.fn(async (plaintext: string) => `encrypted:${plaintext}`),
    decrypt: vi.fn(async (blob: string) => ({
      plaintext: blob.replace("encrypted:", ""),
      needsReencrypt: false,
    })),
  };
}

describe("saveGoogleDriveCredential", () => {
  it("validates and saves a valid service account", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();
    const json = createServiceAccountJson();

    await saveGoogleDriveCredential(db, cipher, {
      serviceAccountJson: json,
      impersonatedUser: "admin@example.com",
      actorUserId: "user-1",
    });

    expect(store.credential).not.toBeNull();
    expect(cipher.encrypt).toHaveBeenCalled();
    const displayMetadata = JSON.parse(store.credential!.displayMetadata!);
    expect(displayMetadata.clientEmail).toBe(
      "test@test-project.iam.gserviceaccount.com"
    );
    expect(displayMetadata.projectId).toBe("test-project");
    const config = JSON.parse(store.credential!.config!);
    expect(config.impersonatedUser).toBe("admin@example.com");
  });

  it("rejects non-JSON input", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await expect(
      saveGoogleDriveCredential(db, cipher, {
        serviceAccountJson: "not json",
        actorUserId: "user-1",
      })
    ).rejects.toThrow("Invalid JSON");
  });

  it("rejects JSON that is not an object", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await expect(
      saveGoogleDriveCredential(db, cipher, {
        serviceAccountJson: '"just a string"',
        actorUserId: "user-1",
      })
    ).rejects.toThrow("expected a JSON object");
  });

  it("rejects non-service-account type", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await expect(
      saveGoogleDriveCredential(db, cipher, {
        serviceAccountJson: createServiceAccountJson({
          type: "authorized_user",
        }),
        actorUserId: "user-1",
      })
    ).rejects.toThrow('"type" must be "service_account"');
  });

  it("rejects missing client_email", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await expect(
      saveGoogleDriveCredential(db, cipher, {
        serviceAccountJson: createServiceAccountJson({ client_email: 42 }),
        actorUserId: "user-1",
      })
    ).rejects.toThrow('"client_email" must be a non-empty string');
  });

  it("rejects missing private_key", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await expect(
      saveGoogleDriveCredential(db, cipher, {
        serviceAccountJson: createServiceAccountJson({ private_key: "" }),
        actorUserId: "user-1",
      })
    ).rejects.toThrow('"private_key" must be a non-empty string');
  });

  it("rejects an invalid PEM key", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await expect(
      saveGoogleDriveCredential(db, cipher, {
        serviceAccountJson: createServiceAccountJson({
          private_key:
            "-----BEGIN PRIVATE KEY-----\nnotvalidbase64\n-----END PRIVATE KEY-----\n",
        }),
        actorUserId: "user-1",
      })
    ).rejects.toThrow("private key is not valid PKCS#8 PEM");
  });

  it("normalizes escaped newlines in the private key", async () => {
    const { privateKeyPem } = generateTestRsaKey();
    const escapedKey = privateKeyPem.replace(/\n/g, "\\n");
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await saveGoogleDriveCredential(db, cipher, {
      serviceAccountJson: createServiceAccountJson({
        private_key: escapedKey,
      }),
      actorUserId: "user-1",
    });

    expect(store.credential).not.toBeNull();
    const encryptedArg = (cipher.encrypt as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    const parsed = JSON.parse(encryptedArg);
    expect(parsed.privateKey).toContain("\n");
    expect(parsed.privateKey).not.toContain("\\n");
  });
});

describe("getGoogleDriveCredentials", () => {
  it("returns null when not configured", async () => {
    const store: MockStore = { credential: null, auditLog: [] };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    const result = await getGoogleDriveCredentials(db, cipher);
    expect(result).toBeNull();
  });

  it("returns parsed credentials when configured", async () => {
    const store: MockStore = {
      credential: {
        ciphertext: `encrypted:${JSON.stringify({
          clientEmail: "test@example.iam.gserviceaccount.com",
          privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
          privateKeyId: "key-123",
        })}`,
        config: JSON.stringify({ impersonatedUser: "admin@example.com" }),
        displayMetadata: null,
      },
      auditLog: [],
    };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    const result = await getGoogleDriveCredentials(db, cipher);
    expect(result).toEqual({
      clientEmail: "test@example.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
      privateKeyId: "key-123",
      impersonatedUser: "admin@example.com",
    });
  });

  it("throws on corrupt stored JSON", async () => {
    const store: MockStore = {
      credential: {
        ciphertext: "encrypted:not-json",
        config: null,
        displayMetadata: null,
      },
      auditLog: [],
    };
    const db = createMockDb(store);
    const cipher = createMockCipher();

    await expect(getGoogleDriveCredentials(db, cipher)).rejects.toThrow(
      "corrupt"
    );
  });
});
