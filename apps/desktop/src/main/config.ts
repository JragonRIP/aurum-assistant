import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  DEFAULT_AURUM_WEB_URL,
  LOCAL_AURUM_WEB_URL,
  isLocalAurumWebUrl,
  resolveAurumWebUrl,
} from "./config-url";

export {
  DEFAULT_AURUM_WEB_URL,
  LOCAL_AURUM_WEB_URL,
  isLocalAurumWebUrl,
  resolveAurumWebUrl,
};

/**
 * Single authoritative Aurum web backend URL for the Windows companion.
 *
 * Resolution:
 * 1. process.env.AURUM_WEB_URL (shell / system env)
 * 2. Optional .env files (dev: package dir; packaged: userData only)
 * 3. DEFAULT_AURUM_WEB_URL (production Vercel)
 *
 * Packaged installs never require a .env file — production is the default.
 */

let loaded = false;

/**
 * Load env files into process.env (main process only).
 * Does not override variables already set in the environment.
 */
export function loadDesktopEnv(): void {
  if (loaded) return;
  loaded = true;

  const roots: string[] = [];

  try {
    if (app.isPackaged) {
      // Installed app: only optional override next to user data (power users).
      // Never depend on process.cwd() — it is not the install directory.
      roots.push(app.getPath("userData"));
    } else {
      roots.push(path.resolve(__dirname, "../.."));
      try {
        roots.push(app.getAppPath());
      } catch {
        // ignore before app ready
      }
      roots.push(process.cwd());
    }
  } catch {
    // app may be unavailable in rare contexts — fall through to default URL
  }

  const seen = new Set<string>();
  for (const root of roots) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    for (const name of [".env", ".env.local"]) {
      applyEnvFile(path.join(root, name));
    }
  }
}

function applyEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** Canonical Aurum web origin used by all desktop networking. */
export function getAurumWebUrl(): string {
  loadDesktopEnv();
  return resolveAurumWebUrl(process.env.AURUM_WEB_URL);
}
