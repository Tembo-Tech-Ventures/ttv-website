import type { Database } from "@/lib/db/schema";
import type { CredentialCipher } from "./crypto";
import {
  setIntegrationCredential,
  getIntegrationCredentialSecret,
  getIntegrationCredentialStatus,
} from "./store";

const PROVIDER = "google-drive";

export interface GoogleDriveCredentials {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  impersonatedUser?: string;
}

function normalizePemNewlines(key: string): string {
  return key.replace(/\\n/g, "\n");
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const lines = pem
    .split("\n")
    .filter((line) => !line.startsWith("-----") && line.trim().length > 0);
  const base64 = lines.join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function validatePrivateKey(pem: string): Promise<void> {
  const der = pemToDer(pem);
  try {
    await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    throw new Error("Invalid service account: private key is not valid PKCS#8 PEM.", {
      cause: error,
    });
  }
}

interface ServiceAccountJson {
  type: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
}

function parseAndValidateServiceAccount(raw: string): ServiceAccountJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON: the pasted value is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid service account: expected a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.type !== "service_account") {
    throw new Error(
      'Invalid service account: "type" must be "service_account".',
    );
  }
  if (typeof obj.client_email !== "string" || !obj.client_email) {
    throw new Error(
      'Invalid service account: "client_email" must be a non-empty string.',
    );
  }
  if (typeof obj.private_key !== "string" || !obj.private_key) {
    throw new Error(
      'Invalid service account: "private_key" must be a non-empty string.',
    );
  }

  return {
    type: obj.type as string,
    client_email: obj.client_email as string,
    private_key: obj.private_key as string,
    private_key_id:
      typeof obj.private_key_id === "string" ? obj.private_key_id : undefined,
    project_id:
      typeof obj.project_id === "string" ? obj.project_id : undefined,
  };
}

export async function saveGoogleDriveCredential(
  db: Database,
  cipher: CredentialCipher,
  options: {
    serviceAccountJson: string;
    impersonatedUser?: string;
    actorUserId: string;
  },
): Promise<void> {
  const sa = parseAndValidateServiceAccount(options.serviceAccountJson);
  const normalizedKey = normalizePemNewlines(sa.private_key);
  await validatePrivateKey(normalizedKey);

  const secret = JSON.stringify({
    clientEmail: sa.client_email,
    privateKey: normalizedKey,
    privateKeyId: sa.private_key_id,
  });

  const displayMetadata = JSON.stringify({
    clientEmail: sa.client_email,
    projectId: sa.project_id,
    privateKeyIdFingerprint: sa.private_key_id
      ? sa.private_key_id.slice(0, 8)
      : undefined,
  });

  const config = JSON.stringify({
    impersonatedUser: options.impersonatedUser || null,
  });

  await setIntegrationCredential(db, cipher, {
    provider: PROVIDER,
    secret,
    config,
    displayMetadata,
    actorUserId: options.actorUserId,
  });
}

export async function getGoogleDriveCredentials(
  db: Database,
  cipher: CredentialCipher,
): Promise<GoogleDriveCredentials | null> {
  const result = await getIntegrationCredentialSecret(db, cipher, PROVIDER);
  if (!result) return null;

  let parsed: { clientEmail: string; privateKey: string; privateKeyId?: string };
  try {
    parsed = JSON.parse(result.secret);
  } catch {
    throw new Error("Stored Google Drive credential is corrupt: invalid JSON.");
  }

  let config: { impersonatedUser?: string | null } = {};
  if (result.config) {
    try {
      config = JSON.parse(result.config);
    } catch {
      // Non-fatal: proceed without config
    }
  }

  return {
    clientEmail: parsed.clientEmail,
    privateKey: parsed.privateKey,
    privateKeyId: parsed.privateKeyId,
    impersonatedUser: config.impersonatedUser || undefined,
  };
}

export async function getGoogleDriveCredentialStatus(db: Database) {
  return getIntegrationCredentialStatus(db, PROVIDER);
}

export const GOOGLE_DRIVE_PROVIDER = PROVIDER;
