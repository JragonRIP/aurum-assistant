import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  const explicit = process.env.INTEGRATION_TOKEN_KEY?.trim();
  if (explicit) {
    // Accept 64-char hex or any string (hashed to 32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(explicit)) {
      return Buffer.from(explicit, "hex");
    }
    return createHash("sha256").update(explicit, "utf8").digest();
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    throw new Error(
      "INTEGRATION_TOKEN_KEY or SUPABASE_SERVICE_ROLE_KEY required to encrypt tokens",
    );
  }
  return createHash("sha256").update(serviceKey, "utf8").digest();
}

/**
 * AES-256-GCM encrypt. Output: base64(iv):base64(authTag):base64(ciphertext)
 * Never log plaintext or the derived key.
 */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const key = deriveKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
