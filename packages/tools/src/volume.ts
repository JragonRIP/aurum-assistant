/** Clamp system/Spotify volume to integer 0–100. */
export function clampVolumePercent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function applyRelativeVolume(
  current: number,
  delta: number,
): number {
  return clampVolumePercent(clampVolumePercent(current) + delta);
}
