/**
 * Phase 4.2 — typed Windows system tools (DESKTOP environment).
 * Model never supplies HWND, shell, or arbitrary executable paths.
 */
import { z } from "zod";
import type { AurumTool, ToolResult } from "./types";
import type { ToolRegistry } from "./registry";

const emptySchema = z.object({});

const volumeAbsoluteSchema = z.object({
  percent: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Windows master volume 0–100"),
});

const volumeDeltaSchema = z.object({
  amount: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Percent steps (default 5)"),
});

const audioDeviceRefSchema = z.object({
  audioDeviceReference: z
    .string()
    .uuid()
    .describe(
      "Trusted audio device reference from get_audio_output_devices — never invent device IDs",
    ),
});

const windowRefSchema = z.object({
  windowReference: z
    .string()
    .uuid()
    .describe(
      "Trusted window reference from get_open_windows — never invent HWND values",
    ),
});

const moveWindowSchema = windowRefSchema.extend({
  x: z.number().int().min(-10000).max(10000),
  y: z.number().int().min(-10000).max(10000),
});

const resizeWindowSchema = windowRefSchema.extend({
  width: z.number().int().min(100).max(10000),
  height: z.number().int().min(100).max(10000),
});

const brightnessSchema = z.object({
  percent: z.number().int().min(0).max(100),
});

const writeTextSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(200_000),
});

const appendTextSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(50_000),
});

const createTextFileSchema = z.object({
  parent_path: z.string().min(1).max(500),
  name: z.string().min(1).max(120),
  content: z.string().max(200_000).optional(),
});

const pathOnlySchema = z.object({
  path: z.string().min(1).max(500),
});

const duplicateSchema = z.object({
  path: z.string().min(1).max(500),
});

type DeviceDispatch = (
  tool: string,
  input: Record<string, unknown>,
  executionId: string,
) => Promise<ToolResult>;

function deviceTool<T extends z.ZodTypeAny>(
  def: Omit<AurumTool<T>, "handler" | "environment"> & { inputSchema: T },
): AurumTool<T> {
  return {
    ...def,
    environment: "DESKTOP",
    async handler(input, ctx): Promise<ToolResult> {
      const dispatch = ctx.dispatchDeviceTool as DeviceDispatch | undefined;
      if (!dispatch) {
        return {
          success: false,
          error: {
            code: "DEVICE_OFFLINE",
            message: "Your Windows device isn't connected.",
          },
          activityLabel: def.activityLabel,
        };
      }
      const executionId =
        ctx.currentExecutionId ??
        `${ctx.generationId ?? "gen"}:${def.id}:${Date.now()}`;
      return dispatch(def.id, input as Record<string, unknown>, executionId);
    },
  };
}

// —— Audio ——
export function createGetSystemVolumeTool() {
  return deviceTool({
    id: "get_system_volume",
    name: "Get system volume",
    description: "Read Windows master volume (0–100) and mute state.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking volume",
  });
}

export function createSetSystemVolumeTool() {
  return deviceTool({
    id: "set_system_volume",
    name: "Set system volume",
    description:
      "Set Windows master volume to an integer percent 0–100. Not Spotify volume.",
    inputSchema: volumeAbsoluteSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Setting volume",
  });
}

export function createIncreaseSystemVolumeTool() {
  return deviceTool({
    id: "increase_system_volume",
    name: "Increase system volume",
    description: "Increase Windows master volume by a small percent step.",
    inputSchema: volumeDeltaSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Increasing volume",
  });
}

export function createDecreaseSystemVolumeTool() {
  return deviceTool({
    id: "decrease_system_volume",
    name: "Decrease system volume",
    description: "Decrease Windows master volume by a small percent step.",
    inputSchema: volumeDeltaSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Decreasing volume",
  });
}

export function createMuteSystemAudioTool() {
  return deviceTool({
    id: "mute_system_audio",
    name: "Mute system audio",
    description: "Mute Windows master audio output.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Muting audio",
  });
}

export function createUnmuteSystemAudioTool() {
  return deviceTool({
    id: "unmute_system_audio",
    name: "Unmute system audio",
    description: "Unmute Windows master audio output.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Unmuting audio",
  });
}

export function createToggleSystemMuteTool() {
  return deviceTool({
    id: "toggle_system_mute",
    name: "Toggle system mute",
    description: "Toggle Windows master mute.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Toggling mute",
  });
}

export function createGetAudioOutputDevicesTool() {
  return deviceTool({
    id: "get_audio_output_devices",
    name: "Get audio output devices",
    description:
      "List Windows playback devices as trusted audioDeviceReference UUIDs.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Listing audio devices",
  });
}

export function createSetAudioOutputDeviceTool() {
  return deviceTool({
    id: "set_audio_output_device",
    name: "Set audio output device",
    description:
      "Switch Windows default playback device using a trusted audioDeviceReference.",
    inputSchema: audioDeviceRefSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Switching audio",
  });
}

export function createGetAudioInputDevicesTool() {
  return deviceTool({
    id: "get_audio_input_devices",
    name: "Get audio input devices",
    description: "List Windows recording (input) devices as trusted references.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Listing microphones",
  });
}

// —— Media keys ——
export function createMediaPlayPauseTool() {
  return deviceTool({
    id: "media_play_pause",
    name: "Media play/pause",
    description:
      "Send the Windows media play/pause key (active media session / focused player).",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Play/pause media",
  });
}

export function createMediaNextTool() {
  return deviceTool({
    id: "media_next",
    name: "Media next",
    description: "Send Windows media next-track key.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Next media",
  });
}

export function createMediaPreviousTool() {
  return deviceTool({
    id: "media_previous",
    name: "Media previous",
    description: "Send Windows media previous-track key.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Previous media",
  });
}

export function createMediaStopTool() {
  return deviceTool({
    id: "media_stop",
    name: "Media stop",
    description: "Send Windows media stop key.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Stopping media",
  });
}

export function createGetCurrentMediaSessionTool() {
  return deviceTool({
    id: "get_current_media_session",
    name: "Get current media session",
    description:
      "Read the current Windows media session title/artist when exposed by the OS.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking media session",
  });
}

// —— Windows ——
export function createGetOpenWindowsTool() {
  return deviceTool({
    id: "get_open_windows",
    name: "Get open windows",
    description:
      "List open top-level windows as trusted windowReference UUIDs. Never invent HWND values.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Listing windows",
  });
}

export function createFocusWindowTool() {
  return deviceTool({
    id: "focus_window",
    name: "Focus window",
    description: "Bring a window to the foreground using a trusted windowReference.",
    inputSchema: windowRefSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Focusing window",
  });
}

export function createMinimizeWindowTool() {
  return deviceTool({
    id: "minimize_window",
    name: "Minimize window",
    description: "Minimize a window by trusted windowReference.",
    inputSchema: windowRefSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Minimizing window",
  });
}

export function createMaximizeWindowTool() {
  return deviceTool({
    id: "maximize_window",
    name: "Maximize window",
    description: "Maximize a window by trusted windowReference.",
    inputSchema: windowRefSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Maximizing window",
  });
}

export function createRestoreWindowTool() {
  return deviceTool({
    id: "restore_window",
    name: "Restore window",
    description: "Restore a minimized/maximized window by trusted windowReference.",
    inputSchema: windowRefSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Restoring window",
  });
}

export function createCloseWindowTool() {
  return deviceTool({
    id: "close_window",
    name: "Close window",
    description:
      "Close a window by trusted windowReference. May discard unsaved work — requires confirmation.",
    inputSchema: windowRefSchema,
    permission: "CONFIRM",
    activityLabel: "Closing window",
  });
}

export function createMoveWindowTool() {
  return deviceTool({
    id: "move_window",
    name: "Move window",
    description: "Move a window to screen coordinates using a trusted windowReference.",
    inputSchema: moveWindowSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Moving window",
  });
}

export function createResizeWindowTool() {
  return deviceTool({
    id: "resize_window",
    name: "Resize window",
    description: "Resize a window using a trusted windowReference.",
    inputSchema: resizeWindowSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Resizing window",
  });
}

// —— Display / device info ——
export function createGetDisplayInfoTool() {
  return deviceTool({
    id: "get_display_info",
    name: "Get display info",
    description: "List display monitors and resolutions.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking displays",
  });
}

export function createGetBatteryStatusTool() {
  return deviceTool({
    id: "get_battery_status",
    name: "Get battery status",
    description: "Read battery charge and power status when available.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking battery",
  });
}

export function createGetPowerStatusTool() {
  return deviceTool({
    id: "get_power_status",
    name: "Get power status",
    description: "Read AC/battery power status.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking power",
  });
}

export function createGetSystemInfoTool() {
  return deviceTool({
    id: "get_system_info",
    name: "Get system info",
    description: "Read sanitized OS/hostname/architecture summary (no secrets).",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking system",
  });
}

export function createGetNetworkStatusTool() {
  return deviceTool({
    id: "get_network_status",
    name: "Get network status",
    description: "Read basic network connectivity (online/offline, primary adapter).",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking network",
  });
}

export function createGetBrightnessTool() {
  return deviceTool({
    id: "get_brightness",
    name: "Get brightness",
    description: "Read display brightness when the hardware exposes it.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking brightness",
  });
}

export function createSetBrightnessTool() {
  return deviceTool({
    id: "set_brightness",
    name: "Set brightness",
    description: "Set display brightness 0–100 when supported.",
    inputSchema: brightnessSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Setting brightness",
  });
}

// —— Files (approved roots) ——
export function createCreateTextFileTool() {
  return deviceTool({
    id: "create_text_file",
    name: "Create text file",
    description: "Create a text file under an approved folder.",
    inputSchema: createTextFileSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Creating file",
  });
}

export function createWriteTextFileTool() {
  return deviceTool({
    id: "write_text_file",
    name: "Write text file",
    description: "Overwrite a text file under an approved folder.",
    inputSchema: writeTextSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Writing file",
  });
}

export function createAppendTextFileTool() {
  return deviceTool({
    id: "append_text_file",
    name: "Append text file",
    description: "Append text to a file under an approved folder.",
    inputSchema: appendTextSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Appending file",
  });
}

export function createDuplicateFileTool() {
  return deviceTool({
    id: "duplicate_file",
    name: "Duplicate file",
    description: "Duplicate a non-executable file in an approved folder.",
    inputSchema: duplicateSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Duplicating file",
  });
}

export function createDeleteFileTool() {
  return deviceTool({
    id: "delete_file",
    name: "Delete file",
    description: "Permanently delete a file under an approved root. Requires confirmation.",
    inputSchema: pathOnlySchema,
    permission: "CONFIRM",
    activityLabel: "Deleting file",
  });
}

export function createDeleteFolderTool() {
  return deviceTool({
    id: "delete_folder",
    name: "Delete folder",
    description:
      "Permanently delete an empty or nested folder under an approved root. Requires confirmation.",
    inputSchema: pathOnlySchema,
    permission: "CONFIRM",
    activityLabel: "Deleting folder",
  });
}

// —— Power ——
export function createLockPcTool() {
  return deviceTool({
    id: "lock_pc",
    name: "Lock PC",
    description: "Lock the Windows session (Win+L equivalent).",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Locking PC",
  });
}

export function createSleepPcTool() {
  return deviceTool({
    id: "sleep_pc",
    name: "Sleep PC",
    description: "Put the PC to sleep. Always requires explicit confirmation.",
    inputSchema: emptySchema,
    permission: "CONFIRM",
    activityLabel: "Sleeping PC",
  });
}

export function createRestartPcTool() {
  return deviceTool({
    id: "restart_pc",
    name: "Restart PC",
    description: "Restart Windows. Always requires explicit confirmation.",
    inputSchema: emptySchema,
    permission: "CONFIRM",
    activityLabel: "Restarting PC",
  });
}

export function createShutdownPcTool() {
  return deviceTool({
    id: "shutdown_pc",
    name: "Shutdown PC",
    description: "Shut down Windows. Always requires explicit confirmation.",
    inputSchema: emptySchema,
    permission: "CONFIRM",
    activityLabel: "Shutting down PC",
  });
}

export function registerWindowsSystemTools(registry: ToolRegistry): void {
  registry.register(createGetSystemVolumeTool());
  registry.register(createSetSystemVolumeTool());
  registry.register(createIncreaseSystemVolumeTool());
  registry.register(createDecreaseSystemVolumeTool());
  registry.register(createMuteSystemAudioTool());
  registry.register(createUnmuteSystemAudioTool());
  registry.register(createToggleSystemMuteTool());
  registry.register(createGetAudioOutputDevicesTool());
  registry.register(createSetAudioOutputDeviceTool());
  registry.register(createGetAudioInputDevicesTool());
  registry.register(createMediaPlayPauseTool());
  registry.register(createMediaNextTool());
  registry.register(createMediaPreviousTool());
  registry.register(createMediaStopTool());
  registry.register(createGetCurrentMediaSessionTool());
  registry.register(createGetOpenWindowsTool());
  registry.register(createFocusWindowTool());
  registry.register(createMinimizeWindowTool());
  registry.register(createMaximizeWindowTool());
  registry.register(createRestoreWindowTool());
  registry.register(createCloseWindowTool());
  registry.register(createMoveWindowTool());
  registry.register(createResizeWindowTool());
  registry.register(createGetDisplayInfoTool());
  registry.register(createGetBatteryStatusTool());
  registry.register(createGetPowerStatusTool());
  registry.register(createGetSystemInfoTool());
  registry.register(createGetNetworkStatusTool());
  registry.register(createGetBrightnessTool());
  registry.register(createSetBrightnessTool());
  registry.register(createCreateTextFileTool());
  registry.register(createWriteTextFileTool());
  registry.register(createAppendTextFileTool());
  registry.register(createDuplicateFileTool());
  registry.register(createDeleteFileTool());
  registry.register(createDeleteFolderTool());
  registry.register(createLockPcTool());
  registry.register(createSleepPcTool());
  registry.register(createRestartPcTool());
  registry.register(createShutdownPcTool());
}
