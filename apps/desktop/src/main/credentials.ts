import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getAurumWebUrl } from "./config";

export type DeviceCredential = {
  deviceId: string;
  deviceSecret: string;
  deviceName: string;
  webUrl: string;
};

const FILE = "device-credential.enc";

function credentialPath(): string {
  return path.join(app.getPath("userData"), FILE);
}

export function saveDeviceCredential(cred: DeviceCredential): void {
  // Always persist the authoritative configured backend URL
  const normalized: DeviceCredential = {
    ...cred,
    webUrl: getAurumWebUrl(),
  };
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: still keep out of renderer; OS user profile only
    fs.writeFileSync(
      credentialPath() + ".json",
      JSON.stringify(normalized),
      { mode: 0o600 },
    );
    return;
  }
  const buf = safeStorage.encryptString(JSON.stringify(normalized));
  fs.writeFileSync(credentialPath(), buf);
  const plain = credentialPath() + ".json";
  if (fs.existsSync(plain)) fs.unlinkSync(plain);
}

export function loadDeviceCredential(): DeviceCredential | null {
  try {
    const enc = credentialPath();
    let parsed: DeviceCredential | null = null;
    if (fs.existsSync(enc) && safeStorage.isEncryptionAvailable()) {
      const raw = safeStorage.decryptString(fs.readFileSync(enc));
      parsed = JSON.parse(raw) as DeviceCredential;
    } else {
      const plain = enc + ".json";
      if (fs.existsSync(plain)) {
        parsed = JSON.parse(fs.readFileSync(plain, "utf8")) as DeviceCredential;
      }
    }
    if (!parsed?.deviceId || !parsed.deviceSecret) return null;
    return withConfiguredWebUrl(parsed);
  } catch {
    return null;
  }
}

/**
 * Ensure device networking always uses the current AURUM_WEB_URL / default.
 * Migrates stored localhost URLs when switching to production.
 */
export function withConfiguredWebUrl(cred: DeviceCredential): DeviceCredential {
  const webUrl = getAurumWebUrl();
  if (cred.webUrl === webUrl) return cred;
  const updated = { ...cred, webUrl };
  try {
    saveDeviceCredential(updated);
  } catch {
    // Still return configured URL even if persist fails
  }
  return updated;
}

export function clearDeviceCredential(): void {
  for (const p of [credentialPath(), credentialPath() + ".json"]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
