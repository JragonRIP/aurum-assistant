/**
 * Constrained Windows master-volume adapter.
 * Uses the loudness fixed Core Audio helper binary with allowlisted args only
 * (integer 0–100, "mute", "unmute"). Never PowerShell / never model-supplied commands.
 */
import loudness from "loudness";

export type MasterAudioState = {
  volume: number;
  muted: boolean;
};

export class WindowsAudioError extends Error {
  constructor(
    readonly code: "AUDIO_CONTROL_FAILED" | "UNSUPPORTED" = "AUDIO_CONTROL_FAILED",
    message = "Windows volume couldn't be changed.",
  ) {
    super(message);
    this.name = "WindowsAudioError";
  }
}

export function clampVolumePercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function applyVolumeDelta(current: number, delta: number): number {
  return clampVolumePercent(current + delta);
}

async function readState(): Promise<MasterAudioState> {
  if (process.platform !== "win32") {
    throw new WindowsAudioError(
      "UNSUPPORTED",
      "Windows audio control requires Windows.",
    );
  }
  try {
    const [volume, muted] = await Promise.all([
      loudness.getVolume(),
      loudness.getMuted(),
    ]);
    return {
      volume: clampVolumePercent(volume),
      muted: Boolean(muted),
    };
  } catch {
    throw new WindowsAudioError();
  }
}

export async function getMasterAudioState(): Promise<MasterAudioState> {
  return readState();
}

export async function setMasterVolumePercent(
  percent: number,
): Promise<MasterAudioState> {
  if (process.platform !== "win32") {
    throw new WindowsAudioError(
      "UNSUPPORTED",
      "Windows audio control requires Windows.",
    );
  }
  const volume = clampVolumePercent(percent);
  try {
    await loudness.setVolume(volume);
    if (volume > 0) {
      await loudness.setMuted(false);
    }
    return readState();
  } catch {
    throw new WindowsAudioError();
  }
}

export async function setMasterMuted(muted: boolean): Promise<MasterAudioState> {
  if (process.platform !== "win32") {
    throw new WindowsAudioError(
      "UNSUPPORTED",
      "Windows audio control requires Windows.",
    );
  }
  try {
    await loudness.setMuted(muted);
    return readState();
  } catch {
    throw new WindowsAudioError();
  }
}

export async function adjustMasterVolumePercent(
  delta: number,
): Promise<MasterAudioState> {
  const current = await getMasterAudioState();
  return setMasterVolumePercent(applyVolumeDelta(current.volume, delta));
}

/** True when a string looks like a leaked shell/PowerShell command line. */
export function looksLikeShellLeak(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("powershell" + ".exe") ||
    t.includes("powershell ") ||
    t.includes("execution" + "policy") ||
    t.includes("-noprofile") ||
    t.includes("cmd" + ".exe") ||
    t.includes("add" + "-type") ||
    /\b(spawn|execfile|child_process)\b/i.test(t)
  );
}

export function sanitizeWindowsToolError(err: unknown): {
  code: string;
  message: string;
} {
  if (err instanceof WindowsAudioError) {
    return { code: err.code, message: err.message };
  }
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (looksLikeShellLeak(raw)) {
    return {
      code: "EXECUTION_FAILED",
      message: "I couldn't complete that Windows action.",
    };
  }
  if (/unsupported|not exposed|not available/i.test(raw)) {
    return {
      code: "UNSUPPORTED",
      message: "That Windows control isn't available on this PC.",
    };
  }
  // Never forward opaque OS/command text to the model/UI
  if (raw.length > 120 || /[\\/].*\.(exe|ps1|bat|cmd)\b/i.test(raw)) {
    return {
      code: "EXECUTION_FAILED",
      message: "I couldn't complete that Windows action.",
    };
  }
  return {
    code: "EXECUTION_FAILED",
    message: "I couldn't complete that Windows action.",
  };
}

/** Sanitize any device tool error before it leaves the companion. */
export function sanitizeDeviceErrorMessage(message: string): string {
  if (!message || looksLikeShellLeak(message)) {
    return "I couldn't complete that Windows action.";
  }
  if (message.length > 180) {
    return "I couldn't complete that Windows action.";
  }
  return message;
}
