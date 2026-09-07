/**
 * Shared authenticated fetch for the desktop companion.
 * Device secrets stay in the main process — never pass them to the renderer.
 */
import { getAurumWebUrl } from "./config";
import type { DeviceCredential } from "./credentials";

export function deviceAuthHeader(cred: DeviceCredential): string {
  return `Bearer ${cred.deviceId}.${cred.deviceSecret}`;
}

export function deviceApiUrl(path: string, cred?: DeviceCredential | null): string {
  const base = getAurumWebUrl();
  if (cred && cred.webUrl !== base) {
    cred.webUrl = base;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export type AuthenticatedDeviceFetchInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string> | Headers;
  /** When false, do not default Content-Type to application/json. */
  json?: boolean;
};

/**
 * Attach canonical device Authorization. For FormData bodies, do not set Content-Type.
 */
export async function authenticatedDeviceFetch(
  cred: DeviceCredential,
  path: string,
  init: AuthenticatedDeviceFetchInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", deviceAuthHeader(cred));

  const body = init.body;
  const isFormData =
    typeof FormData !== "undefined" && body instanceof FormData;

  if (isFormData) {
    // Let the runtime set multipart boundary — never force Content-Type.
    headers.delete("Content-Type");
  } else if (init.json !== false && body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(deviceApiUrl(path, cred), {
    ...init,
    headers,
  });
}
