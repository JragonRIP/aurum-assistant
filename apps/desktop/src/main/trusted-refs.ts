/**
 * Desktop-local trusted object store.
 * Gemini only ever sees UUIDs — never HWND, PID, paths-as-IDs, or OS device IDs.
 */
import { randomUUID } from "node:crypto";

export type TrustedWindow = {
  hwnd: number;
  title: string;
  processName: string;
  processId?: number;
};

export type TrustedAudioDevice = {
  id: string;
  name: string;
  direction: "render" | "capture";
  isDefault: boolean;
};

export type TrustedMonitor = {
  displayId: number;
  index: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  primary: boolean;
};

export type TrustedProcess = {
  pid: number;
  name: string;
  memoryMb: number | null;
};

export type TrustedApp = {
  displayName: string;
  /** Resolved Start Menu shortcut or target — never exposed to Gemini */
  targetPath: string;
};

export type TrustedFile = {
  path: string;
  name: string;
  kind: "file" | "folder";
};

export type TrustedScreenshot = {
  path: string;
  width: number;
  height: number;
  capturedAt: string;
};

export type TrustedUiElement = {
  /** Opaque automation id — short-lived; full UIA deferred */
  automationId: string;
  name: string;
  controlType: string;
  expiresAt: number;
};

type Entry<T> = { value: T; expiresAt: number };

const TTL_MS = 30 * 60 * 1000;
const UI_TTL_MS = 2 * 60 * 1000;

const windows = new Map<string, Entry<TrustedWindow>>();
const audioDevices = new Map<string, Entry<TrustedAudioDevice>>();
const monitors = new Map<string, Entry<TrustedMonitor>>();
const processes = new Map<string, Entry<TrustedProcess>>();
const apps = new Map<string, Entry<TrustedApp>>();
const files = new Map<string, Entry<TrustedFile>>();
const screenshots = new Map<string, Entry<TrustedScreenshot>>();
const uiElements = new Map<string, Entry<TrustedUiElement>>();

function prune<T>(map: Map<string, Entry<T>>, max = 400): void {
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.expiresAt < now) map.delete(k);
  }
  while (map.size > max) {
    const first = map.keys().next().value;
    if (!first) break;
    map.delete(first);
  }
}

function remember<T>(
  map: Map<string, Entry<T>>,
  value: T,
  ttlMs = TTL_MS,
): string {
  prune(map);
  const id = randomUUID();
  map.set(id, { value, expiresAt: Date.now() + ttlMs });
  return id;
}

function resolve<T>(map: Map<string, Entry<T>>, ref: unknown): T | null {
  if (typeof ref !== "string") return null;
  prune(map);
  const entry = map.get(ref.trim());
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

export function rememberWindow(win: TrustedWindow): string {
  return remember(windows, win);
}
export function resolveWindow(ref: unknown): TrustedWindow | null {
  return resolve(windows, ref);
}

export function rememberAudioDevice(device: TrustedAudioDevice): string {
  return remember(audioDevices, device);
}
export function resolveAudioDevice(ref: unknown): TrustedAudioDevice | null {
  return resolve(audioDevices, ref);
}

export function rememberMonitor(mon: TrustedMonitor): string {
  return remember(monitors, mon);
}
export function resolveMonitor(ref: unknown): TrustedMonitor | null {
  return resolve(monitors, ref);
}

export function rememberProcess(proc: TrustedProcess): string {
  return remember(processes, proc);
}
export function resolveProcess(ref: unknown): TrustedProcess | null {
  return resolve(processes, ref);
}

export function rememberApp(app: TrustedApp): string {
  return remember(apps, app);
}
export function resolveApp(ref: unknown): TrustedApp | null {
  return resolve(apps, ref);
}

export function rememberFile(file: TrustedFile): string {
  return remember(files, file);
}
export function resolveFile(ref: unknown): TrustedFile | null {
  return resolve(files, ref);
}

export function rememberScreenshot(shot: TrustedScreenshot): string {
  return remember(screenshots, shot);
}
export function resolveScreenshot(ref: unknown): TrustedScreenshot | null {
  return resolve(screenshots, ref);
}

export function rememberUiElement(
  el: Omit<TrustedUiElement, "expiresAt">,
): string {
  return remember(
    uiElements,
    { ...el, expiresAt: Date.now() + UI_TTL_MS },
    UI_TTL_MS,
  );
}
export function resolveUiElement(ref: unknown): TrustedUiElement | null {
  return resolve(uiElements, ref);
}

/** Test helper */
export function clearTrustedDesktopRefs(): void {
  windows.clear();
  audioDevices.clear();
  monitors.clear();
  processes.clear();
  apps.clear();
  files.clear();
  screenshots.clear();
  uiElements.clear();
}
