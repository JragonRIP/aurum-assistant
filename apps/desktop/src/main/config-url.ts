/**
 * Pure URL resolution for the Aurum desktop companion backend.
 * Keep free of Electron imports so it can be unit-tested.
 */

/** Production Aurum web backend */
export const DEFAULT_AURUM_WEB_URL =
  "https://aurum-assistant-aurum-web-design.vercel.app";

/** Documented local development override */
export const LOCAL_AURUM_WEB_URL = "http://127.0.0.1:3000";

/** Canonical origin (no trailing slash). */
export function resolveAurumWebUrl(fromEnv?: string | null): string {
  const raw = (fromEnv?.trim() || DEFAULT_AURUM_WEB_URL).replace(/\/$/, "");
  return raw;
}

export function isLocalAurumWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1"
    );
  } catch {
    return false;
  }
}
