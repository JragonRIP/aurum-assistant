/**
 * Continuous Core spin targets — degrees per second.
 * Used by JS lerp so state changes never restart CSS keyframe animations.
 */

export type PresenceSpinTargets = {
  ticks: number;
  micro: number;
  primary: number;
  secondary: number;
  /** Soft scale pulse amplitude (0–1) for core breathe */
  pulseAmp: number;
};

const IDLE: PresenceSpinTargets = {
  ticks: 3,
  micro: -4.3,
  primary: 1.5,
  secondary: -3.75,
  pulseAmp: 0.035,
};

export function presenceSpinTargets(
  state: string,
  presentation?: string,
  reducedMotion?: boolean,
): PresenceSpinTargets {
  if (reducedMotion || state === "OFFLINE") {
    return { ticks: 0, micro: 0, primary: 0, secondary: 0, pulseAmp: 0 };
  }
  if (state === "WAITING_FOR_APPROVAL") {
    return { ticks: 0.4, micro: -0.35, primary: 0.25, secondary: -0.3, pulseAmp: 0.04 };
  }
  if (state === "WAITING_FOR_USER") {
    return { ticks: 1.2, micro: -1.1, primary: 0.7, secondary: -0.9, pulseAmp: 0.045 };
  }
  if (state === "ERROR") {
    return { ticks: 1.5, micro: -1.2, primary: 0.8, secondary: -1, pulseAmp: 0.02 };
  }
  if (presentation === "responding") {
    return { ticks: 3.75, micro: -7.5, primary: 5, secondary: -4, pulseAmp: 0.04 };
  }
  if (state === "THINKING" || presentation === "thinking") {
    return { ticks: 10, micro: -25.7, primary: 16.4, secondary: -8, pulseAmp: 0.055 };
  }
  if (state === "LISTENING") {
    return { ticks: 6, micro: -12, primary: 8, secondary: -6, pulseAmp: 0.05 };
  }
  if (state === "ACTING" || state === "SPEAKING") {
    return { ticks: 7.5, micro: -10, primary: 6, secondary: -5, pulseAmp: 0.06 };
  }
  return IDLE;
}

/** Exponential lerp factor for angular velocity (per frame at ~60fps). */
export function lerpSpin(current: number, target: number, dtMs: number): number {
  const k = 1 - Math.exp(-dtMs / 280);
  return current + (target - current) * k;
}
