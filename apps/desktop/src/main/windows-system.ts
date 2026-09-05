/**
 * WindowsSystemAdapter — typed OS actions.
 * Audio uses constrained Core Audio helper (loudness). Win32 via koffi.
 * Never executes model-supplied shell/PowerShell strings.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import {
  adjustMasterVolumePercent,
  getMasterAudioState,
  sanitizeWindowsToolError,
  setMasterMuted,
  setMasterVolumePercent,
  WindowsAudioError,
} from "./windows-audio";
import {
  rememberAudioDevice,
  rememberWindow,
  resolveAudioDevice,
  resolveWindow,
} from "./trusted-refs";
import type { DeviceToolResult } from "./windows-tools";
import {
  enumerateOpenWindows,
  getNativePowerStatus,
  postCloseWindow,
  setForegroundWindow,
  setWindowPos,
  showWindow,
  tapMediaKey,
} from "./windows-win32";

const execFileAsync = promisify(execFile);

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function failSafe(err: unknown, fallbackMessage: string): DeviceToolResult {
  const sanitized = sanitizeWindowsToolError(err);
  if (sanitized.code === "AUDIO_CONTROL_FAILED" || sanitized.code === "UNSUPPORTED") {
    return {
      success: false,
      error: { code: sanitized.code, message: sanitized.message },
    };
  }
  return {
    success: false,
    error: { code: "EXECUTION_FAILED", message: fallbackMessage },
  };
}

function unsupported(message: string): DeviceToolResult {
  return {
    success: false,
    error: { code: "UNSUPPORTED", message },
  };
}

export async function windowsSystemExecute(
  tool: string,
  payload: Record<string, unknown>,
): Promise<DeviceToolResult | null> {
  if (process.platform !== "win32") {
    if (
      tool.startsWith("get_") ||
      tool.includes("volume") ||
      tool.includes("window") ||
      tool.includes("media") ||
      tool.includes("pc") ||
      tool.includes("brightness") ||
      tool.includes("audio")
    ) {
      return {
        success: false,
        error: {
          code: "UNSUPPORTED",
          message: "Windows system tools require Windows.",
        },
      };
    }
    return null;
  }

  try {
    switch (tool) {
      case "get_system_volume":
        return await getSystemVolume();
      case "set_system_volume":
        return await setSystemVolume(clampPercent(Number(payload.percent)));
      case "increase_system_volume":
        return await bumpVolume(Number(payload.amount ?? 5));
      case "decrease_system_volume":
        return await bumpVolume(-Number(payload.amount ?? 5));
      case "mute_system_audio":
        return await setMute(true);
      case "unmute_system_audio":
        return await setMute(false);
      case "toggle_system_mute":
        return await toggleMute();
      case "get_audio_output_devices":
      case "get_audio_input_devices":
        return unsupported(
          "Listing audio devices isn't available in this build. Use Windows Sound settings.",
        );
      case "set_audio_output_device":
        return await setAudioOutput(payload.audioDeviceReference);
      case "media_play_pause":
        tapMediaKey("play_pause");
        return { success: true, data: { activityLabel: "Play/pause sent" } };
      case "media_next":
        tapMediaKey("next");
        return { success: true, data: { activityLabel: "Next media" } };
      case "media_previous":
        tapMediaKey("previous");
        return { success: true, data: { activityLabel: "Previous media" } };
      case "media_stop":
        tapMediaKey("stop");
        return { success: true, data: { activityLabel: "Stop media" } };
      case "get_current_media_session":
        return unsupported(
          "Media session details aren't available without shell access on this build.",
        );
      case "get_open_windows":
        return getOpenWindows();
      case "focus_window":
        return windowAction(payload.windowReference, "focus");
      case "minimize_window":
        return windowAction(payload.windowReference, "minimize");
      case "maximize_window":
        return windowAction(payload.windowReference, "maximize");
      case "restore_window":
        return windowAction(payload.windowReference, "restore");
      case "close_window":
        return windowAction(payload.windowReference, "close");
      case "move_window":
        return moveWindow(
          payload.windowReference,
          Number(payload.x),
          Number(payload.y),
        );
      case "resize_window":
        return resizeWindow(
          payload.windowReference,
          Number(payload.width),
          Number(payload.height),
        );
      case "get_display_info":
        return getDisplayInfo();
      case "get_battery_status":
      case "get_power_status":
        return getPowerStatus();
      case "get_system_info":
        return getSystemInfo();
      case "get_network_status":
        return getNetworkStatus();
      case "get_brightness":
      case "set_brightness":
        return unsupported(
          "Display brightness isn't available without shell access on this build.",
        );
      case "lock_pc":
        // Fixed argv only — CONTROLLED OS API (never model-supplied)
        await execFileAsync(
          "rundll32.exe",
          ["user32.dll,LockWorkStation"],
          { windowsHide: true, timeout: 5000 },
        );
        return { success: true, data: { activityLabel: "PC locked" } };
      case "sleep_pc":
        await execFileAsync(
          "rundll32.exe",
          ["powrprof.dll,SetSuspendState", "0,1,0"],
          { windowsHide: true, timeout: 5000 },
        );
        return { success: true, data: { activityLabel: "Sleeping" } };
      case "restart_pc":
        await execFileAsync("shutdown.exe", ["/r", "/t", "0"], {
          windowsHide: true,
          timeout: 5000,
        });
        return { success: true, data: { activityLabel: "Restarting" } };
      case "shutdown_pc":
        await execFileAsync("shutdown.exe", ["/s", "/t", "0"], {
          windowsHide: true,
          timeout: 5000,
        });
        return { success: true, data: { activityLabel: "Shutting down" } };
      default:
        return null;
    }
  } catch (err) {
    console.error("[aurum:windows-system]", tool, err);
    if (err instanceof WindowsAudioError) {
      return {
        success: false,
        error: { code: err.code, message: err.message },
      };
    }
    return failSafe(err, "I couldn't complete that Windows action.");
  }
}

async function getSystemVolume(): Promise<DeviceToolResult> {
  const state = await getMasterAudioState();
  return {
    success: true,
    data: {
      percent: state.volume,
      muted: state.muted,
      volume: state.volume,
      activityLabel: `Volume ${state.volume}%`,
    },
    message: state.muted
      ? `Volume is muted (${state.volume}%).`
      : `Volume is ${state.volume}%.`,
  };
}

async function setSystemVolume(percent: number): Promise<DeviceToolResult> {
  const state = await setMasterVolumePercent(percent);
  return {
    success: true,
    data: {
      percent: state.volume,
      muted: state.muted,
      volume: state.volume,
      activityLabel: `Setting volume · ${state.volume}%`,
    },
    message: `Windows volume set to ${state.volume}%.`,
  };
}

async function bumpVolume(delta: number): Promise<DeviceToolResult> {
  const state = await adjustMasterVolumePercent(delta);
  return {
    success: true,
    data: {
      percent: state.volume,
      muted: state.muted,
      volume: state.volume,
      activityLabel:
        delta >= 0
          ? `Increasing volume · ${state.volume}%`
          : `Decreasing volume · ${state.volume}%`,
    },
    message: `Windows volume is now ${state.volume}%.`,
  };
}

async function setMute(muted: boolean): Promise<DeviceToolResult> {
  const state = await setMasterMuted(muted);
  return {
    success: true,
    data: {
      muted: state.muted,
      volume: state.volume,
      percent: state.volume,
      activityLabel: muted ? "Muting audio" : "Unmuting audio",
    },
    message: muted ? "Windows audio muted." : "Windows audio unmuted.",
  };
}

async function toggleMute(): Promise<DeviceToolResult> {
  const cur = await getMasterAudioState();
  return setMute(!cur.muted);
}

async function setAudioOutput(ref: unknown): Promise<DeviceToolResult> {
  const device = resolveAudioDevice(ref);
  if (!device) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired audio device reference. List devices again.",
      },
    };
  }
  void rememberAudioDevice;
  return unsupported(
    `Switching default audio to “${device.name}” isn't available in this build. Open Settings → System → Sound.`,
  );
}

function getOpenWindows(): DeviceToolResult {
  const windows = [];
  for (const w of enumerateOpenWindows(40)) {
    const referenceId = rememberWindow({
      hwnd: w.hwnd,
      title: w.title,
      processName: `pid:${w.processId}`,
    });
    windows.push({
      referenceId,
      title: w.title,
      processName: `pid:${w.processId}`,
    });
  }
  return {
    success: true,
    data: { windows, activityLabel: "Listed windows" },
  };
}

function windowAction(
  ref: unknown,
  action: "focus" | "minimize" | "maximize" | "restore" | "close",
): DeviceToolResult {
  const win = resolveWindow(ref);
  if (!win) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired window reference. List windows again.",
      },
    };
  }
  const hwnd = Math.trunc(win.hwnd);
  if (!Number.isFinite(hwnd) || hwnd <= 0) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid window handle." },
    };
  }

  const showCmd =
    action === "minimize"
      ? 6
      : action === "maximize"
        ? 3
        : action === "restore" || action === "focus"
          ? 9
          : 0;

  if (action === "close") {
    postCloseWindow(hwnd);
  } else {
    showWindow(hwnd, showCmd);
    setForegroundWindow(hwnd);
  }

  return {
    success: true,
    data: {
      title: win.title,
      action,
      activityLabel:
        action === "close"
          ? `Closing · ${win.title}`
          : action === "focus"
            ? `Focusing · ${win.title}`
            : `${action} · ${win.title}`,
    },
  };
}

function moveWindow(ref: unknown, x: number, y: number): DeviceToolResult {
  const win = resolveWindow(ref);
  if (!win) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired window reference.",
      },
    };
  }
  const hwnd = Math.trunc(win.hwnd);
  const xi = Math.trunc(x);
  const yi = Math.trunc(y);
  setWindowPos(hwnd, xi, yi, 0, 0, 0x0001 | 0x0004);
  return { success: true, data: { title: win.title, x: xi, y: yi } };
}

function resizeWindow(
  ref: unknown,
  width: number,
  height: number,
): DeviceToolResult {
  const win = resolveWindow(ref);
  if (!win) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired window reference.",
      },
    };
  }
  const hwnd = Math.trunc(win.hwnd);
  const w = Math.max(100, Math.min(10000, Math.trunc(width)));
  const h = Math.max(100, Math.min(10000, Math.trunc(height)));
  setWindowPos(hwnd, 0, 0, w, h, 0x0002 | 0x0004);
  return { success: true, data: { title: win.title, width: w, height: h } };
}

function getDisplayInfo(): DeviceToolResult {
  try {
    // Electron main process screen API — SAFE NODE/ELECTRON API
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { screen } = require("electron") as typeof import("electron");
    const displays = screen.getAllDisplays().map((d, i) => ({
      name: d.label || `Display ${i + 1}`,
      width: d.size.width,
      height: d.size.height,
      primary: d.id === screen.getPrimaryDisplay().id,
    }));
    return {
      success: true,
      data: { displays, activityLabel: "Checked displays" },
    };
  } catch {
    return unsupported("Could not read display information.");
  }
}

function getPowerStatus(): DeviceToolResult {
  const status = getNativePowerStatus();
  return {
    success: true,
    data: {
      onBattery: status.onBattery,
      percent: status.percent,
      activityLabel: "Checked power",
    },
  };
}

function getSystemInfo(): DeviceToolResult {
  return {
    success: true,
    data: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus()?.[0]?.model ?? null,
      totalMemGb: Math.round((os.totalmem() / 1e9) * 10) / 10,
      activityLabel: "Checked system",
    },
  };
}

function getNetworkStatus(): DeviceToolResult {
  const ifaces = os.networkInterfaces();
  const adapters: Array<{ name: string; speed: string | null }> = [];
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries?.some((e) => !e.internal)) continue;
    adapters.push({ name, speed: null });
    if (adapters.length >= 5) break;
  }
  return {
    success: true,
    data: {
      online: adapters.length > 0,
      adapters,
      activityLabel: "Checked network",
    },
  };
}
