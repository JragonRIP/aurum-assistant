import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifySecret(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function generateDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** 8-char pairing code (high entropy alphanumeric, no ambiguous chars) */
export function generatePairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function hashPairingCode(code: string): string {
  return hashSecret(code.trim().toUpperCase());
}

export function pairingCodeHint(code: string): string {
  const c = code.trim().toUpperCase();
  return `${c.slice(0, 2)}••••${c.slice(-2)}`;
}
