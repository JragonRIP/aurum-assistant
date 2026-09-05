/**
 * Session-scoped media context — NOT long-term memory.
 * Cleared when the process restarts; keyed by conversationId.
 */

export type MediaContext = {
  activeProvider: "spotify";
  trackLabel?: string;
  artistLabel?: string;
  volumePercent?: number;
  isPlaying?: boolean;
  trackReference?: string;
  deviceReference?: string;
  updatedAt: number;
};

const store = new Map<string, MediaContext>();

const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function getMediaContext(conversationId: string): MediaContext | null {
  const ctx = store.get(conversationId);
  if (!ctx) return null;
  if (Date.now() - ctx.updatedAt > MAX_AGE_MS) {
    store.delete(conversationId);
    return null;
  }
  return ctx;
}

export function setMediaContext(
  conversationId: string,
  patch: Partial<Omit<MediaContext, "activeProvider" | "updatedAt">> & {
    activeProvider?: "spotify";
  },
): MediaContext {
  const prev = store.get(conversationId);
  const next: MediaContext = {
    activeProvider: "spotify",
    trackLabel: patch.trackLabel ?? prev?.trackLabel,
    artistLabel: patch.artistLabel ?? prev?.artistLabel,
    volumePercent: patch.volumePercent ?? prev?.volumePercent,
    isPlaying: patch.isPlaying ?? prev?.isPlaying,
    trackReference: patch.trackReference ?? prev?.trackReference,
    deviceReference: patch.deviceReference ?? prev?.deviceReference,
    updatedAt: Date.now(),
  };
  store.set(conversationId, next);
  return next;
}

export function clearMediaContext(conversationId: string): void {
  store.delete(conversationId);
}

/** Clamp Spotify volume to integer 0–100 */
export function clampVolume(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export type RelativeVolumeIntent =
  | "a_little_quieter"
  | "turn_down"
  | "much_quieter"
  | "a_little_louder"
  | "turn_up"
  | "much_louder";

const RELATIVE_DELTAS: Record<RelativeVolumeIntent, number> = {
  a_little_quieter: -10,
  turn_down: -15,
  much_quieter: -25,
  a_little_louder: 10,
  turn_up: 15,
  much_louder: 25,
};

/** Apply semantic relative volume change; always clamps 0–100 */
export function applyRelativeVolume(
  currentPercent: number,
  intent: RelativeVolumeIntent,
): number {
  const delta = RELATIVE_DELTAS[intent] ?? 0;
  return clampVolume(currentPercent + delta);
}

export function relativeVolumeDelta(intent: RelativeVolumeIntent): number {
  return RELATIVE_DELTAS[intent] ?? 0;
}
