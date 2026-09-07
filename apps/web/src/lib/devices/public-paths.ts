/**
 * Paths that accept device Bearer auth (or pairing) without a Supabase user session.
 * User-session device management routes (/api/devices, /api/devices/[id]) stay protected.
 */
export function isDeviceBearerApiPath(pathname: string): boolean {
  if (pathname === "/api/devices/pair") return true;
  if (pathname.startsWith("/api/devices/bridge")) return true;
  if (pathname.startsWith("/api/devices/assistant")) return true;
  if (pathname.startsWith("/api/devices/voice")) return true;
  // Desktop companion may approve folders with device credentials
  if (/^\/api\/devices\/[^/]+\/roots(?:\/|$)/.test(pathname)) return true;
  return false;
}

export function isPublicApiPath(pathname: string): boolean {
  if (pathname.startsWith("/api/health")) return true;
  return isDeviceBearerApiPath(pathname);
}
