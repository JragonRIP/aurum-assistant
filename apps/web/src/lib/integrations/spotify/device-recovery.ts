/**
 * Spotify Connect playback-device recovery (server-side).
 * Opens the Windows Spotify app when needed, polls for devices with backoff,
 * transfers to a usable device, then lets the original play_* mutation proceed.
 *
 * Pure selection + schedule helpers are unit-tested without network.
 */

export type RecoverableDevice = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
};

/** Delays between polls (ms). First attempt is immediate (0). ~15s window. */
export const DEVICE_POLL_DELAYS_MS = [
  0, 500, 1000, 2000, 3000, 3500, 4000,
] as const;

export const DEVICE_RECOVERY_FAILURE_MESSAGE =
  "I opened Spotify, but it hasn't appeared as a playback device yet. Open Spotify and start playback once, then try again.";

export const DEVICE_RECOVERY_FAILURE_NO_OPEN_MESSAGE =
  "No Spotify playback device is available. Open Spotify on this PC and try again.";

export function selectPlaybackDevice(
  devices: RecoverableDevice[],
): RecoverableDevice | null {
  const usable = devices.filter((d) => Boolean(d.id) && !d.isRestricted);
  if (usable.length === 0) return null;

  const active = usable.find((d) => d.isActive);
  if (active) return active;

  const computer = usable.find((d) => /computer/i.test(d.type));
  if (computer) return computer;

  return usable[0] ?? null;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type DeviceRecoveryDeps = {
  getDevices: () => Promise<RecoverableDevice[]>;
  /** Opens Spotify via Windows companion open_application — at most once. */
  openSpotifyDesktop?: () => Promise<{ ok: boolean; message?: string }>;
  transferPlayback: (deviceId: string, play: boolean) => Promise<void>;
  signal?: AbortSignal;
  onActivity?: (label: string) => void;
  pollDelaysMs?: readonly number[];
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type DeviceRecoverySuccess = {
  ok: true;
  deviceId: string;
  deviceName: string;
  openedSpotify: boolean;
  transferred: boolean;
};

export type DeviceRecoveryFailure = {
  ok: false;
  openedSpotify: boolean;
  cancelled: boolean;
  message: string;
};

export type DeviceRecoveryResult = DeviceRecoverySuccess | DeviceRecoveryFailure;

/**
 * Ensure a usable Spotify Connect device exists for playback.
 * Does not execute the original play mutation — caller resumes that intent.
 */
export async function ensureSpotifyPlaybackDevice(
  deps: DeviceRecoveryDeps,
): Promise<DeviceRecoveryResult> {
  const delays = deps.pollDelaysMs ?? DEVICE_POLL_DELAYS_MS;
  const sleepFn = deps.sleepFn ?? sleep;
  let openedSpotify = false;
  let openAttempted = false;

  const trySelect = async (): Promise<RecoverableDevice | null> => {
    const devices = await deps.getDevices();
    return selectPlaybackDevice(devices);
  };

  const cancelled = (): DeviceRecoveryFailure => ({
    ok: false,
    openedSpotify,
    cancelled: true,
    message: "Cancelled.",
  });

  try {
    for (let i = 0; i < delays.length; i++) {
      if (deps.signal?.aborted) return cancelled();

      const delay = delays[i] ?? 0;
      if (delay > 0) {
        deps.onActivity?.("Waiting for Spotify…");
        await sleepFn(delay, deps.signal);
      }

      deps.onActivity?.(
        i === 0 ? "Connecting to Spotify…" : "Waiting for Spotify…",
      );

      let selected = await trySelect();

      if (!selected && !openAttempted && deps.openSpotifyDesktop) {
        openAttempted = true;
        deps.onActivity?.("Opening Spotify…");
        const opened = await deps.openSpotifyDesktop();
        openedSpotify = Boolean(opened.ok);
        // Continue polling — do not play yet
        selected = await trySelect();
      }

      if (!selected) continue;

      let transferred = false;
      if (!selected.isActive) {
        deps.onActivity?.("Connecting to Spotify…");
        await deps.transferPlayback(selected.id, false);
        transferred = true;
      }

      return {
        ok: true,
        deviceId: selected.id,
        deviceName: selected.name,
        openedSpotify,
        transferred,
      };
    }
  } catch (err) {
    if (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      return cancelled();
    }
    throw err;
  }

  return {
    ok: false,
    openedSpotify,
    cancelled: false,
    message: openedSpotify
      ? DEVICE_RECOVERY_FAILURE_MESSAGE
      : DEVICE_RECOVERY_FAILURE_NO_OPEN_MESSAGE,
  };
}
