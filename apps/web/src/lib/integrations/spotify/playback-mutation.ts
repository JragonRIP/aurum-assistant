/**
 * Verified Spotify playback mutations (next/previous/pause/resume).
 * HTTP acceptance alone is not success — confirm state changed.
 */
import type { ToolResult } from "@aurum/tools";

export const PLAYBACK_VERIFY_DELAYS_MS = [250, 500, 900, 1400, 2000] as const;
export const MAX_PLAYBACK_MUTATION_ATTEMPTS = 2;
export const RETRY_BACKOFF_MS = 350;

export type PlaybackSnapshot = {
  trackId: string | null;
  trackName: string | null;
  artists: string[];
  progressMs: number | null;
  isPlaying: boolean;
  deviceId: string | null;
};

export type PlaybackMutationConfirmation =
  | "CONFIRMED"
  | "ACCEPTED_UNCONFIRMED"
  | "RATE_LIMITED"
  | "NO_DEVICE"
  | "FAILED";

export type SkipDirection = "next" | "previous";

export function sanitizeTrackIdentity(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function snapshotFromPlayback(state: {
  isPlaying: boolean;
  progressMs: number | null;
  device?: { id: string } | null;
  track?: {
    id: string;
    name: string;
    artists: string[];
  } | null;
} | null): PlaybackSnapshot | null {
  if (!state) return null;
  return {
    trackId: state.track?.id ?? null,
    trackName: state.track?.name ?? null,
    artists: state.track?.artists ?? [],
    progressMs: state.progressMs,
    isPlaying: state.isPlaying,
    deviceId: state.device?.id ?? null,
  };
}

export function trackIdChanged(
  before: PlaybackSnapshot | null,
  after: PlaybackSnapshot | null,
): boolean {
  const a = before?.trackId ?? null;
  const b = after?.trackId ?? null;
  if (a == null && b == null) return false;
  return a !== b;
}

export function playingStateChanged(
  before: PlaybackSnapshot | null,
  after: PlaybackSnapshot | null,
  wantPlaying: boolean,
): boolean {
  if (!after) return false;
  if (after.isPlaying !== wantPlaying) return false;
  // If we had no prior snapshot, accept matching target state as confirmation.
  if (!before) return true;
  return before.isPlaying !== after.isPlaying || after.isPlaying === wantPlaying;
}

export async function sleepMs(
  ms: number,
  signal?: AbortSignal,
  sleepImpl: (ms: number) => Promise<void> = (n) =>
    new Promise((r) => setTimeout(r, n)),
): Promise<void> {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
  await sleepImpl(ms);
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
}

/**
 * Poll until track id changes or delays exhaust.
 * Delays are absolute offsets from start (250, 500, …).
 */
export async function pollUntilTrackChanges(opts: {
  before: PlaybackSnapshot | null;
  getState: () => Promise<PlaybackSnapshot | null>;
  delaysMs?: readonly number[];
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ confirmed: boolean; after: PlaybackSnapshot | null }> {
  const delays = opts.delaysMs ?? PLAYBACK_VERIFY_DELAYS_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((n: number) => new Promise((r) => setTimeout(r, n)));
  const started = now();
  let after: PlaybackSnapshot | null = null;

  for (const absolute of delays) {
    const wait = Math.max(0, absolute - (now() - started));
    if (wait > 0) await sleepMs(wait, opts.signal, sleep);
    after = await opts.getState();
    if (trackIdChanged(opts.before, after)) {
      return { confirmed: true, after };
    }
  }
  return { confirmed: false, after };
}

export async function pollUntilPlayingState(opts: {
  before: PlaybackSnapshot | null;
  wantPlaying: boolean;
  getState: () => Promise<PlaybackSnapshot | null>;
  delaysMs?: readonly number[];
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ confirmed: boolean; after: PlaybackSnapshot | null }> {
  const delays = opts.delaysMs ?? PLAYBACK_VERIFY_DELAYS_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((n: number) => new Promise((r) => setTimeout(r, n)));
  const started = now();
  let after: PlaybackSnapshot | null = null;

  for (const absolute of delays) {
    const wait = Math.max(0, absolute - (now() - started));
    if (wait > 0) await sleepMs(wait, opts.signal, sleep);
    after = await opts.getState();
    if (after && after.isPlaying === opts.wantPlaying) {
      // Confirmed if state matches target and (changed or already matched after mutate)
      if (!opts.before || opts.before.isPlaying !== opts.wantPlaying) {
        return { confirmed: true, after };
      }
      return { confirmed: true, after };
    }
  }
  return { confirmed: false, after };
}

export type SkipMutationDeps = {
  direction: SkipDirection;
  getState: () => Promise<PlaybackSnapshot | null>;
  mutate: (deviceId: string | undefined) => Promise<void>;
  ensureDevice: () => Promise<
    { ok: true; deviceId: string } | { ok: false; result: ToolResult }
  >;
  signal?: AbortSignal;
  executionId?: string;
  log?: (event: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxAttempts?: number;
  verifyDelaysMs?: readonly number[];
  retryBackoffMs?: number;
};

function trackLabel(snap: PlaybackSnapshot | null): string | null {
  if (!snap?.trackName) return null;
  if (snap.artists.length === 0) return snap.trackName;
  return `${snap.trackName} — ${snap.artists.join(", ")}`;
}

export async function runVerifiedSkipMutation(
  deps: SkipMutationDeps,
): Promise<ToolResult> {
  const maxAttempts = deps.maxAttempts ?? MAX_PLAYBACK_MUTATION_ATTEMPTS;
  const verifyDelays = deps.verifyDelaysMs ?? PLAYBACK_VERIFY_DELAYS_MS;
  const retryBackoff = deps.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const sleep = deps.sleep;
  const started = (deps.now ?? Date.now)();

  const device = await deps.ensureDevice();
  if (!device.ok) return device.result;

  let before = await deps.getState();
  let deviceId = before?.deviceId ?? device.deviceId;
  let attempts = 0;
  let lastAfter: PlaybackSnapshot | null = before;

  while (attempts < maxAttempts) {
    attempts += 1;

    // Re-check before retry so a delayed first mutation cannot double-skip.
    if (attempts > 1) {
      const latest = await deps.getState();
      if (trackIdChanged(before, latest)) {
        deps.log?.({
          event: "spotify_playback_mutation",
          operation: deps.direction,
          executionId: deps.executionId ?? null,
          attempt: attempts,
          confirmed: true,
          retryCancelled: true,
          beforeTrack: sanitizeTrackIdentity(before?.trackId),
          afterTrack: sanitizeTrackIdentity(latest?.trackId),
          latencyMs: (deps.now ?? Date.now)() - started,
        });
        const label = trackLabel(latest);
        return {
          success: true,
          message:
            deps.direction === "next"
              ? label
                ? `Skipped. Playing ${label}.`
                : "Skipped."
              : label
                ? `Back to the previous track. Playing ${label}.`
                : "Back to the previous track.",
          activityLabel:
            deps.direction === "next" ? "Skipped track" : "Previous track",
          data: {
            confirmation: "CONFIRMED" satisfies PlaybackMutationConfirmation,
            confirmed: true,
            previousTrack: before
              ? { id: before.trackId, name: before.trackName, artists: before.artists }
              : null,
            currentTrack: latest
              ? { id: latest.trackId, name: latest.trackName, artists: latest.artists }
              : null,
            attempts: attempts - 1,
          },
        };
      }
      before = latest ?? before;
      deviceId = latest?.deviceId ?? deviceId;
      await sleepMs(retryBackoff, deps.signal, sleep);
    }

    deps.log?.({
      event: "spotify_playback_mutation",
      operation: deps.direction,
      executionId: deps.executionId ?? null,
      attempt: attempts,
      deviceAvailable: Boolean(deviceId),
      beforeTrack: sanitizeTrackIdentity(before?.trackId),
      phase: "mutate",
    });

    await deps.mutate(deviceId);

    const verified = await pollUntilTrackChanges({
      before,
      getState: deps.getState,
      delaysMs: verifyDelays,
      signal: deps.signal,
      sleep,
      now: deps.now,
    });
    lastAfter = verified.after;

    deps.log?.({
      event: "spotify_playback_mutation",
      operation: deps.direction,
      executionId: deps.executionId ?? null,
      attempt: attempts,
      httpAccepted: true,
      beforeTrack: sanitizeTrackIdentity(before?.trackId),
      afterTrack: sanitizeTrackIdentity(verified.after?.trackId),
      confirmed: verified.confirmed,
      latencyMs: (deps.now ?? Date.now)() - started,
    });

    if (verified.confirmed) {
      const label = trackLabel(verified.after);
      return {
        success: true,
        message:
          deps.direction === "next"
            ? label
              ? `Skipped. Playing ${label}.`
              : "Skipped."
            : label
              ? `Back to the previous track. Playing ${label}.`
              : "Back to the previous track.",
        activityLabel:
          deps.direction === "next" ? "Skipped track" : "Previous track",
        data: {
          confirmation: "CONFIRMED" satisfies PlaybackMutationConfirmation,
          confirmed: true,
          previousTrack: before
            ? { id: before.trackId, name: before.trackName, artists: before.artists }
            : null,
          currentTrack: verified.after
            ? {
                id: verified.after.trackId,
                name: verified.after.trackName,
                artists: verified.after.artists,
              }
            : null,
          attempts,
        },
      };
    }
  }

  return {
    success: false,
    error: {
      code: "PLAYBACK_CHANGE_NOT_CONFIRMED",
      message: "Spotify didn't confirm the track change.",
    },
    activityLabel:
      deps.direction === "next" ? "Skip not confirmed" : "Previous not confirmed",
    data: {
      confirmation: "ACCEPTED_UNCONFIRMED" satisfies PlaybackMutationConfirmation,
      confirmed: false,
      previousTrack: before
        ? { id: before.trackId, name: before.trackName, artists: before.artists }
        : null,
      currentTrack: lastAfter
        ? {
            id: lastAfter.trackId,
            name: lastAfter.trackName,
            artists: lastAfter.artists,
          }
        : null,
      attempts: maxAttempts,
    },
  };
}

export type PlayPauseMutationDeps = {
  action: "pause" | "resume";
  getState: () => Promise<PlaybackSnapshot | null>;
  mutate: (deviceId: string | undefined) => Promise<void>;
  ensureDevice: () => Promise<
    { ok: true; deviceId: string } | { ok: false; result: ToolResult }
  >;
  signal?: AbortSignal;
  executionId?: string;
  log?: (event: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  verifyDelaysMs?: readonly number[];
};

export async function runVerifiedPlayPauseMutation(
  deps: PlayPauseMutationDeps,
): Promise<ToolResult> {
  const wantPlaying = deps.action === "resume";
  const device = await deps.ensureDevice();
  if (!device.ok) return device.result;

  const before = await deps.getState();
  const deviceId = before?.deviceId ?? device.deviceId;
  const started = (deps.now ?? Date.now)();

  // Already in desired state — confirm without mutating (avoids false "success" no-ops).
  if (before && before.isPlaying === wantPlaying) {
    return {
      success: true,
      message: wantPlaying ? "Resumed Spotify." : "Paused Spotify.",
      activityLabel: wantPlaying ? "Resumed Spotify" : "Paused Spotify",
      data: {
        confirmation: "CONFIRMED" satisfies PlaybackMutationConfirmation,
        confirmed: true,
        isPlaying: before.isPlaying,
        alreadyInState: true,
      },
    };
  }

  deps.log?.({
    event: "spotify_playback_mutation",
    operation: deps.action,
    executionId: deps.executionId ?? null,
    attempt: 1,
    deviceAvailable: Boolean(deviceId),
    beforePlaying: before?.isPlaying ?? null,
    phase: "mutate",
  });

  await deps.mutate(deviceId);

  const verified = await pollUntilPlayingState({
    before,
    wantPlaying,
    getState: deps.getState,
    delaysMs: deps.verifyDelaysMs ?? PLAYBACK_VERIFY_DELAYS_MS,
    signal: deps.signal,
    sleep: deps.sleep,
    now: deps.now,
  });

  deps.log?.({
    event: "spotify_playback_mutation",
    operation: deps.action,
    executionId: deps.executionId ?? null,
    attempt: 1,
    httpAccepted: true,
    beforePlaying: before?.isPlaying ?? null,
    afterPlaying: verified.after?.isPlaying ?? null,
    confirmed: verified.confirmed,
    latencyMs: (deps.now ?? Date.now)() - started,
  });

  if (verified.confirmed) {
    return {
      success: true,
      message: wantPlaying ? "Resumed Spotify." : "Paused Spotify.",
      activityLabel: wantPlaying ? "Resumed Spotify" : "Paused Spotify",
      data: {
        confirmation: "CONFIRMED" satisfies PlaybackMutationConfirmation,
        confirmed: true,
        isPlaying: verified.after?.isPlaying ?? wantPlaying,
      },
    };
  }

  return {
    success: false,
    error: {
      code: "PLAYBACK_CHANGE_NOT_CONFIRMED",
      message:
        deps.action === "pause"
          ? "Spotify didn't confirm the pause."
          : "Spotify didn't confirm resume.",
    },
    activityLabel:
      deps.action === "pause" ? "Pause not confirmed" : "Resume not confirmed",
    data: {
      confirmation: "ACCEPTED_UNCONFIRMED" satisfies PlaybackMutationConfirmation,
      confirmed: false,
      isPlaying: verified.after?.isPlaying ?? null,
    },
  };
}
