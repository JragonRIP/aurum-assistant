/**
 * Desktop-local trusted object store for window / audio device references.
 * Gemini only ever sees UUIDs — never HWND or OS device IDs.
 */
import { randomUUID } from "node:crypto";

export type TrustedWindow = {
  hwnd: number;
  title: string;
  processName: string;
};

export type TrustedAudioDevice = {
  /** Stable id used by Windows audio APIs (stringified) */
  id: string;
  name: string;
  direction: "render" | "capture";
  isDefault: boolean;
};

type Entry<T> = { value: T; expiresAt: number };

const TTL_MS = 30 * 60 * 1000;
const windows = new Map<string, Entry<TrustedWindow>>();
const audioDevices = new Map<string, Entry<TrustedAudioDevice>>();

function prune<T>(map: Map<string, Entry<T>>): void {
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.expiresAt < now) map.delete(k);
  }
  if (map.size > 400) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
}

export function rememberWindow(win: TrustedWindow): string {
  prune(windows);
  const id = randomUUID();
  windows.set(id, { value: win, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function resolveWindow(ref: unknown): TrustedWindow | null {
  if (typeof ref !== "string") return null;
  prune(windows);
  const entry = windows.get(ref.trim());
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

export function rememberAudioDevice(device: TrustedAudioDevice): string {
  prune(audioDevices);
  const id = randomUUID();
  audioDevices.set(id, { value: device, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function resolveAudioDevice(ref: unknown): TrustedAudioDevice | null {
  if (typeof ref !== "string") return null;
  prune(audioDevices);
  const entry = audioDevices.get(ref.trim());
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

/** Test helper */
export function clearTrustedDesktopRefs(): void {
  windows.clear();
  audioDevices.clear();
}
