import { describe, expect, it } from "vitest";
import { createCredentialCipher } from "./crypto";

function generateKeyBase64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("createCredentialCipher", () => {
  const key = generateKeyBase64();
  const aad = "google-drive";

  it("encrypts and decrypts a roundtrip successfully", async () => {
    const cipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: key,
    });
    const plaintext = '{"clientEmail":"test@example.iam.gserviceaccount.com"}';
    const blob = await cipher.encrypt(plaintext, aad);
    const result = await cipher.decrypt(blob, aad);
    expect(result.plaintext).toBe(plaintext);
    expect(result.needsReencrypt).toBe(false);
  });

  it("produces the v1.<keyId>.<iv>.<ciphertext> blob format", async () => {
    const cipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: key,
    });
    const blob = await cipher.encrypt("test", aad);
    const parts = blob.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toHaveLength(8);
    expect(parts[1]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("generates unique IVs per encryption", async () => {
    const cipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: key,
    });
    const blob1 = await cipher.encrypt("test", aad);
    const blob2 = await cipher.encrypt("test", aad);
    const iv1 = blob1.split(".")[2];
    const iv2 = blob2.split(".")[2];
    expect(iv1).not.toBe(iv2);
  });

  it("rejects a tampered blob", async () => {
    const cipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: key,
    });
    const blob = await cipher.encrypt("test", aad);
    const parts = blob.split(".");
    const tampered = [parts[0], parts[1], parts[2], parts[3] + "AAAA"].join(
      "."
    );
    await expect(cipher.decrypt(tampered, aad)).rejects.toThrow(
      "Credential decryption failed authentication",
    );
  });

  it("rejects decryption with wrong AAD", async () => {
    const cipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: key,
    });
    const blob = await cipher.encrypt("test", "google-drive");
    await expect(cipher.decrypt(blob, "wrong-provider")).rejects.toThrow(
      "Credential decryption failed authentication",
    );
  });

  it("rejects a blob encrypted with an unknown key", async () => {
    const cipher1 = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: generateKeyBase64(),
    });
    const cipher2 = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: generateKeyBase64(),
    });
    const blob = await cipher1.encrypt("test", aad);
    await expect(cipher2.decrypt(blob, aad)).rejects.toThrow(
      "unknown key"
    );
  });

  it("decrypts with the previous key and reports needsReencrypt", async () => {
    const oldKey = generateKeyBase64();
    const newKey = generateKeyBase64();

    const oldCipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: oldKey,
    });
    const blob = await oldCipher.encrypt("rotated-secret", aad);

    const rotatedCipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: newKey,
      CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: oldKey,
    });
    const result = await rotatedCipher.decrypt(blob, aad);
    expect(result.plaintext).toBe("rotated-secret");
    expect(result.needsReencrypt).toBe(true);
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is missing on encrypt", async () => {
    const cipher = createCredentialCipher({});
    await expect(cipher.encrypt("test", aad)).rejects.toThrow(
      "CREDENTIALS_ENCRYPTION_KEY is not configured"
    );
  });

  it("throws when CREDENTIALS_ENCRYPTION_KEY is missing on decrypt", async () => {
    const cipher = createCredentialCipher({});
    await expect(cipher.decrypt("v1.abcd1234.iv.ct", aad)).rejects.toThrow(
      "CREDENTIALS_ENCRYPTION_KEY is not configured"
    );
  });

  it("rejects an invalid blob format", async () => {
    const cipher = createCredentialCipher({
      CREDENTIALS_ENCRYPTION_KEY: key,
    });
    await expect(cipher.decrypt("not-a-valid-blob", aad)).rejects.toThrow(
      "Invalid credential blob format"
    );
    await expect(cipher.decrypt("v2.keyid.iv.ct", aad)).rejects.toThrow(
      "Invalid credential blob format"
    );
  });
});
