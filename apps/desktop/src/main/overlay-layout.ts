/**
 * Pure overlay layout sizing (no Electron imports).
 * Compact grows with content; expanded uses most of the work area.
 */

export type OverlayLayoutMode = "idle" | "compact" | "full";

export type OverlayWorkArea = {
  width: number;
  height: number;
};

export type OverlaySize = {
  width: number;
  height: number;
};

export const OVERLAY_IDLE_SIZE: OverlaySize = { width: 640, height: 148 };

/** Compact max height before Show full is required (px). */
export const OVERLAY_COMPACT_MAX_HEIGHT = 360;

/** Reply character / line thresholds for Show full. */
export const OVERLAY_SHOW_FULL_MIN_CHARS = 420;
export const OVERLAY_SHOW_FULL_MIN_LINES = 10;

export function shouldOfferShowFull(reply: string): boolean {
  const text = reply.trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/).length;
  return (
    text.length >= OVERLAY_SHOW_FULL_MIN_CHARS ||
    lines >= OVERLAY_SHOW_FULL_MIN_LINES
  );
}

/**
 * Clamp proposed overlay size into the monitor work area with margins.
 */
export function clampOverlaySize(
  proposed: OverlaySize,
  workArea: OverlayWorkArea,
): OverlaySize {
  const marginX = 24;
  const marginY = 48;
  const maxW = Math.max(320, workArea.width - marginX);
  const maxH = Math.max(140, Math.floor(workArea.height * 0.85));
  return {
    width: Math.min(Math.max(proposed.width, 320), maxW),
    height: Math.min(Math.max(proposed.height, 140), maxH),
  };
}

export function resolveOverlaySize(opts: {
  mode: OverlayLayoutMode;
  contentHeightPx?: number;
  workArea: OverlayWorkArea;
}): OverlaySize {
  const { mode, workArea } = opts;
  if (mode === "idle") {
    return clampOverlaySize(OVERLAY_IDLE_SIZE, workArea);
  }

  if (mode === "full") {
    const width = Math.min(820, Math.max(700, Math.floor(workArea.width * 0.55)));
    const height = Math.floor(workArea.height * 0.82);
    return clampOverlaySize({ width, height }, workArea);
  }

  // compact: grow with content up to compact max
  const width = Math.min(700, Math.max(560, Math.floor(workArea.width * 0.48)));
  const chrome = 132; // core + input + padding estimate
  const body = Math.max(0, opts.contentHeightPx ?? 0);
  const height = Math.min(
    OVERLAY_COMPACT_MAX_HEIGHT,
    Math.max(OVERLAY_IDLE_SIZE.height, chrome + body),
  );
  return clampOverlaySize({ width, height }, workArea);
}

/** Bottom-center position within work area. */
export function positionOverlayBounds(
  size: OverlaySize,
  workArea: { x: number; y: number; width: number; height: number },
  bottomGapPx = 36,
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(size.width, workArea.width - 24);
  const height = Math.min(size.height, Math.floor(workArea.height * 0.85));
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height - height - bottomGapPx);
  return { x, y, width, height };
}
