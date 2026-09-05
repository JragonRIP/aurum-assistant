import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

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
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: still keep out of renderer; OS user profile only
    fs.writeFileSync(
      credentialPath() + ".json",
      JSON.stringify(cred),
      { mode: 0o600 },
    );
    return;
  }
  const buf = safeStorage.encryptString(JSON.stringify(cred));
  fs.writeFileSync(credentialPath(), buf);
  const plain = credentialPath() + ".json";
  if (fs.existsSync(plain)) fs.unlinkSync(plain);
}

export function loadDeviceCredential(): DeviceCredential | null {
  try {
    const enc = credentialPath();
    if (fs.existsSync(enc) && safeStorage.isEncryptionAvailable()) {
      const raw = safeStorage.decryptString(fs.readFileSync(enc));
      return JSON.parse(raw) as DeviceCredential;
    }
    const plain = enc + ".json";
    if (fs.existsSync(plain)) {
      return JSON.parse(fs.readFileSync(plain, "utf8")) as DeviceCredential;
    }
  } catch {
    return null;
  }
  return null;
}

export function clearDeviceCredential(): void {
  for (const p of [credentialPath(), credentialPath() + ".json"]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
