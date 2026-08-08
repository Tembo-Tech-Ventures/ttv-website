const BLOB_VERSION = "v1";
const IV_BYTES = 12;
const KEY_ID_HEX_LENGTH = 8;

function base64urlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(encoded: string): Uint8Array<ArrayBuffer> {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeKeyMaterial(
  name: string,
  value: string,
): Uint8Array<ArrayBuffer> {
  const normalized = value
    .trim()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64urlDecode(normalized);
  } catch {
    throw new Error(`${name} is not valid base64.`);
  }
  if (bytes.length !== 32) {
    throw new Error(
      `${name} must decode to exactly 32 bytes (got ${bytes.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return bytes;
}

async function deriveKeyId(rawKeyBytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", rawKeyBytes);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, KEY_ID_HEX_LENGTH);
}

async function importKey(
  rawKeyBytes: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKeyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

interface ResolvedKey {
  cryptoKey: CryptoKey;
  keyId: string;
}

export interface CredentialCipher {
  encrypt(plaintext: string, aad: string): Promise<string>;
  decrypt(blob: string, aad: string): Promise<{ plaintext: string; needsReencrypt: boolean }>;
}

export function createCredentialCipher(env: {
  CREDENTIALS_ENCRYPTION_KEY?: string;
  CREDENTIALS_ENCRYPTION_KEY_PREVIOUS?: string;
}): CredentialCipher {
  const primaryRaw = env.CREDENTIALS_ENCRYPTION_KEY?.trim()
    ? decodeKeyMaterial(
        "CREDENTIALS_ENCRYPTION_KEY",
        env.CREDENTIALS_ENCRYPTION_KEY,
      )
    : null;
  const previousRaw = env.CREDENTIALS_ENCRYPTION_KEY_PREVIOUS?.trim()
    ? decodeKeyMaterial(
        "CREDENTIALS_ENCRYPTION_KEY_PREVIOUS",
        env.CREDENTIALS_ENCRYPTION_KEY_PREVIOUS,
      )
    : null;

  let primaryKey: ResolvedKey | null = null;
  let previousKey: ResolvedKey | null = null;

  async function ensurePrimaryKey(): Promise<ResolvedKey> {
    if (primaryKey) return primaryKey;
    if (!primaryRaw) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured.");
    }
    primaryKey = {
      cryptoKey: await importKey(primaryRaw),
      keyId: await deriveKeyId(primaryRaw),
    };
    return primaryKey;
  }

  async function ensurePreviousKey(): Promise<ResolvedKey | null> {
    if (previousKey) return previousKey;
    if (!previousRaw) return null;
    previousKey = {
      cryptoKey: await importKey(previousRaw),
      keyId: await deriveKeyId(previousRaw),
    };
    return previousKey;
  }

  return {
    async encrypt(plaintext: string, aad: string): Promise<string> {
      const key = await ensurePrimaryKey();
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const encoded = new TextEncoder().encode(plaintext);
      const aadEncoded = new TextEncoder().encode(aad);
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aadEncoded },
        key.cryptoKey,
        encoded,
      );
      return [
        BLOB_VERSION,
        key.keyId,
        base64urlEncode(iv.buffer),
        base64urlEncode(ciphertext),
      ].join(".");
    },

    async decrypt(
      blob: string,
      aad: string,
    ): Promise<{ plaintext: string; needsReencrypt: boolean }> {
      const parts = blob.split(".");
      if (parts.length !== 4 || parts[0] !== BLOB_VERSION) {
        throw new Error("Invalid credential blob format.");
      }
      const [, blobKeyId, ivEncoded, ciphertextEncoded] = parts;

      const primary = await ensurePrimaryKey();
      const previous = await ensurePreviousKey();

      let selectedKey: ResolvedKey;
      let needsReencrypt = false;

      if (blobKeyId === primary.keyId) {
        selectedKey = primary;
      } else if (previous && blobKeyId === previous.keyId) {
        selectedKey = previous;
        needsReencrypt = true;
      } else {
        throw new Error(
          "Credential blob was encrypted with an unknown key. The required encryption key may have been rotated out.",
        );
      }

      const iv = base64urlDecode(ivEncoded);
      const ciphertext = base64urlDecode(ciphertextEncoded);
      const aadEncoded = new TextEncoder().encode(aad);
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aadEncoded },
        selectedKey.cryptoKey,
        ciphertext,
      );
      return {
        plaintext: new TextDecoder().decode(decrypted),
        needsReencrypt,
      };
    },
  };
}
