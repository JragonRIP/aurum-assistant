/**
 * Restrict media/microphone permission to Aurum app origins only.
 */
import type { Session } from "electron";
import { getAurumWebUrl } from "./config";

function isTrustedOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return true;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    const web = new URL(getAurumWebUrl());
    if (u.origin === web.origin) return true;
    // Packaged overlay uses file:// or custom; also allow aurum app hosts
    if (u.hostname.endsWith("aurum-assistant.vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

export function installMediaPermissionHandlers(session: Session): void {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl =
      details.requestingUrl || webContents.getURL() || "";
    const mediaOk =
      permission === "media" ||
      permission === "mediaKeySystem" ||
      permission === "display-capture";

    // Only microphone/media for trusted Aurum surfaces — deny other media-adjacent
    if (permission !== "media" && permission !== "mediaKeySystem") {
      // allow display-capture denial by default
      if (permission === "display-capture") {
        callback(false);
        return;
      }
      callback(false);
      return;
    }

    const allowed = isTrustedOrigin(requestingUrl);
    console.info("[aurum:voice:permission]", {
      permission,
      allowed,
      host: (() => {
        try {
          return new URL(requestingUrl).host || "file";
        } catch {
          return "unknown";
        }
      })(),
    });
    callback(allowed);
  });

  session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (permission !== "media" && permission !== "mediaKeySystem") {
      return false;
    }
    return isTrustedOrigin(requestingOrigin || "file://");
  });
}
