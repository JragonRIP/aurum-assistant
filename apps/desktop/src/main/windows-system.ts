/**
 * WindowsSystemAdapter — typed OS actions via allowlisted fixed scripts.
 * Never executes model-supplied shell/PowerShell strings.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import {
  rememberAudioDevice,
  rememberWindow,
  resolveAudioDevice,
  resolveWindow,
} from "./trusted-refs";
import type { DeviceToolResult } from "./windows-tools";

const execFileAsync = promisify(execFile);

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function runPs(script: string, timeoutMs = 12_000): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("Windows only");
  }
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

/** Fixed Core Audio helper — only numeric literals are substituted. */
const AUDIO_HELPER = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF740782BA3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int NotImpl1(); int NotImpl2();
  int GetChannelCount(out int pcChannels);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public class AurumAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice device; enumerator.GetDefaultAudioEndpoint(0, 0, out device);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o; device.Activate(ref iid, 1, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static float GetVolume() { float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static void SetVolume(float v) { Vol().SetMasterVolumeLevelScalar(v, Guid.Empty); }
  public static bool GetMute() { bool m; Vol().GetMute(out m); return m; }
  public static void SetMute(bool m) { Vol().SetMute(m, Guid.Empty); }
}
"@ -ErrorAction SilentlyContinue
`;

function mediaKeyScript(vk: number): string {
  // vk is a fixed constant from our code only
  return `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class AurumKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Tap(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
[AurumKeys]::Tap(${vk})
`;
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
        error: { code: "UNSUPPORTED", message: "Windows system tools require Windows." },
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
        return await listAudioDevices("render");
      case "get_audio_input_devices":
        return await listAudioDevices("capture");
      case "set_audio_output_device":
        return await setAudioOutput(payload.audioDeviceReference);
      case "media_play_pause":
        await runPs(mediaKeyScript(0xb3));
        return { success: true, data: { activityLabel: "Play/pause sent" } };
      case "media_next":
        await runPs(mediaKeyScript(0xb0));
        return { success: true, data: { activityLabel: "Next media" } };
      case "media_previous":
        await runPs(mediaKeyScript(0xb1));
        return { success: true, data: { activityLabel: "Previous media" } };
      case "media_stop":
        await runPs(mediaKeyScript(0xb2));
        return { success: true, data: { activityLabel: "Stop media" } };
      case "get_current_media_session":
        return await getMediaSession();
      case "get_open_windows":
        return await getOpenWindows();
      case "focus_window":
        return await windowAction(payload.windowReference, "focus");
      case "minimize_window":
        return await windowAction(payload.windowReference, "minimize");
      case "maximize_window":
        return await windowAction(payload.windowReference, "maximize");
      case "restore_window":
        return await windowAction(payload.windowReference, "restore");
      case "close_window":
        return await windowAction(payload.windowReference, "close");
      case "move_window":
        return await moveWindow(
          payload.windowReference,
          Number(payload.x),
          Number(payload.y),
        );
      case "resize_window":
        return await resizeWindow(
          payload.windowReference,
          Number(payload.width),
          Number(payload.height),
        );
      case "get_display_info":
        return await getDisplayInfo();
      case "get_battery_status":
      case "get_power_status":
        return await getPowerStatus();
      case "get_system_info":
        return getSystemInfo();
      case "get_network_status":
        return await getNetworkStatus();
      case "get_brightness":
        return await getBrightness();
      case "set_brightness":
        return await setBrightness(clampPercent(Number(payload.percent)));
      case "lock_pc":
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
    return {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: err instanceof Error ? err.message.slice(0, 200) : "Windows action failed.",
      },
    };
  }
}

async function getSystemVolume(): Promise<DeviceToolResult> {
  const out = await runPs(`
${AUDIO_HELPER}
$v = [math]::Round([AurumAudio]::GetVolume() * 100)
$m = [AurumAudio]::GetMute()
Write-Output "$v|$m"
`);
  const [vs, ms] = out.split("|");
  const percent = clampPercent(Number(vs));
  const muted = String(ms).toLowerCase() === "true";
  return {
    success: true,
    data: { percent, muted, activityLabel: `Volume ${percent}%` },
  };
}

async function setSystemVolume(percent: number): Promise<DeviceToolResult> {
  const p = clampPercent(percent);
  await runPs(`
${AUDIO_HELPER}
[AurumAudio]::SetVolume(${(p / 100).toFixed(4)})
[AurumAudio]::SetMute($false)
`);
  return {
    success: true,
    data: { percent: p, muted: false, activityLabel: `Setting volume · ${p}%` },
  };
}

async function bumpVolume(delta: number): Promise<DeviceToolResult> {
  const cur = await getSystemVolume();
  const current = Number((cur.data as { percent?: number })?.percent ?? 0);
  return setSystemVolume(current + delta);
}

async function setMute(muted: boolean): Promise<DeviceToolResult> {
  await runPs(`
${AUDIO_HELPER}
[AurumAudio]::SetMute($${muted ? "true" : "false"})
`);
  return {
    success: true,
    data: {
      muted,
      activityLabel: muted ? "Muting audio" : "Unmuting audio",
    },
  };
}

async function toggleMute(): Promise<DeviceToolResult> {
  const cur = await getSystemVolume();
  const muted = Boolean((cur.data as { muted?: boolean })?.muted);
  return setMute(!muted);
}

async function listAudioDevices(
  direction: "render" | "capture",
): Promise<DeviceToolResult> {
  const flow = direction === "render" ? 0 : 1;
  const out = await runPs(`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
# Fallback: list via Win32_PnP / Sound devices names
Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name
`);
  const names = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const devices = names.map((name, i) => {
    const id = `${direction}:${i}:${name}`;
    const referenceId = rememberAudioDevice({
      id,
      name,
      direction,
      isDefault: i === 0,
    });
    return {
      referenceId,
      name,
      direction,
      default: i === 0,
    };
  });
  void flow;
  return {
    success: true,
    data: {
      devices,
      activityLabel:
        direction === "render" ? "Listed audio devices" : "Listed microphones",
    },
  };
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
  // Default endpoint switch requires vendor APIs; report honest limitation with trusted label.
  return {
    success: false,
    error: {
      code: "UNSUPPORTED",
      message: `Switching default audio to “${device.name}” requires Windows sound settings on this build. Open Settings → System → Sound, or tell me to open Sound settings.`,
    },
    data: { device: device.name },
  };
}

async function getMediaSession(): Promise<DeviceToolResult> {
  try {
    const out = await runPs(`
$s = Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 8 ProcessName, MainWindowTitle
$s | ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)" }
`);
    const sessions = out
      .split(/\r?\n/)
      .map((line) => {
        const [processName, ...rest] = line.split("|");
        return {
          processName: processName?.trim() ?? "",
          title: rest.join("|").trim(),
        };
      })
      .filter((s) => s.title);
    return {
      success: true,
      data: {
        sessions,
        note: "Windows GlobalSystemMediaTransportControls may be unavailable; showing window titles instead.",
        activityLabel: "Checked media session",
      },
    };
  } catch {
    return {
      success: true,
      data: { sessions: [], activityLabel: "No media session" },
    };
  }
}

async function getOpenWindows(): Promise<DeviceToolResult> {
  const out = await runPs(`
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  Select-Object -First 40 ProcessName, Id, MainWindowTitle, MainWindowHandle |
  ForEach-Object { "$($_.MainWindowHandle)|$($_.ProcessName)|$($_.MainWindowTitle)" }
`);
  const windows = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [hwndStr, processName, ...titleParts] = line.split("|");
    const hwnd = Number(hwndStr);
    if (!Number.isFinite(hwnd) || hwnd === 0) continue;
    const title = titleParts.join("|").trim();
    const referenceId = rememberWindow({
      hwnd,
      title,
      processName: (processName ?? "").trim(),
    });
    windows.push({
      referenceId,
      title,
      processName: (processName ?? "").trim(),
    });
  }
  return {
    success: true,
    data: { windows, activityLabel: "Listed windows" },
  };
}

async function windowAction(
  ref: unknown,
  action: "focus" | "minimize" | "maximize" | "restore" | "close",
): Promise<DeviceToolResult> {
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
    await runPs(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public class AurumWin {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
[AurumWin]::PostMessage([IntPtr]${hwnd}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
`);
  } else {
    await runPs(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public class AurumWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[AurumWin]::ShowWindow([IntPtr]${hwnd}, ${showCmd}) | Out-Null
[AurumWin]::SetForegroundWindow([IntPtr]${hwnd}) | Out-Null
`);
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

async function moveWindow(
  ref: unknown,
  x: number,
  y: number,
): Promise<DeviceToolResult> {
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
  await runPs(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public class AurumWin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
[AurumWin]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]::Zero, ${xi}, ${yi}, 0, 0, 0x0001 -bor 0x0004) | Out-Null
`);
  return { success: true, data: { title: win.title, x: xi, y: yi } };
}

async function resizeWindow(
  ref: unknown,
  width: number,
  height: number,
): Promise<DeviceToolResult> {
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
  await runPs(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public class AurumWin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
[AurumWin]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]::Zero, 0, 0, ${w}, ${h}, 0x0002 -bor 0x0004) | Out-Null
`);
  return { success: true, data: { title: win.title, width: w, height: h } };
}

async function getDisplayInfo(): Promise<DeviceToolResult> {
  const out = await runPs(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  "$($_.DeviceName)|$($_.Bounds.Width)|$($_.Bounds.Height)|$($_.Primary)"
}
`);
  const displays = out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, w, h, primary] = line.split("|");
      return {
        name: name ?? "Display",
        width: Number(w),
        height: Number(h),
        primary: String(primary).toLowerCase() === "true",
      };
    });
  return { success: true, data: { displays, activityLabel: "Checked displays" } };
}

async function getPowerStatus(): Promise<DeviceToolResult> {
  const out = await runPs(`
$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if ($b) { Write-Output "$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)" } else { Write-Output "AC|0" }
`);
  const [charge, status] = out.split("|");
  const percent = charge === "AC" ? null : clampPercent(Number(charge));
  return {
    success: true,
    data: {
      onBattery: charge !== "AC",
      percent,
      batteryStatus: status ?? null,
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

async function getNetworkStatus(): Promise<DeviceToolResult> {
  const online = true;
  const out = await runPs(`
Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
  Where-Object Status -eq 'Up' |
  Select-Object -First 3 Name, LinkSpeed |
  ForEach-Object { "$($_.Name)|$($_.LinkSpeed)" }
`);
  const adapters = out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, speed] = line.split("|");
      return { name, speed };
    });
  return {
    success: true,
    data: { online, adapters, activityLabel: "Checked network" },
  };
}

async function getBrightness(): Promise<DeviceToolResult> {
  try {
    const out = await runPs(`
(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop |
  Select-Object -First 1 CurrentBrightness).CurrentBrightness
`);
    const percent = clampPercent(Number(out));
    return { success: true, data: { percent, activityLabel: `Brightness ${percent}%` } };
  } catch {
    return {
      success: false,
      error: {
        code: "UNSUPPORTED",
        message: "Brightness is not exposed on this display.",
      },
    };
  }
}

async function setBrightness(percent: number): Promise<DeviceToolResult> {
  const p = clampPercent(percent);
  try {
    await runPs(`
$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${p}} | Out-Null
`);
    return {
      success: true,
      data: { percent: p, activityLabel: `Setting brightness · ${p}%` },
    };
  } catch {
    return {
      success: false,
      error: {
        code: "UNSUPPORTED",
        message: "Could not set brightness on this display.",
      },
    };
  }
}
