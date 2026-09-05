import { z } from "zod";

export const DeviceRequestPayloadSchema = z.record(z.unknown());

export const DeviceRequestEnvelopeSchema = z.object({
  requestId: z.string().min(8).max(80),
  deviceId: z.string().uuid(),
  tool: z.string().min(1).max(80),
  executionId: z.string().min(8).max(160),
  payload: DeviceRequestPayloadSchema,
  issuedAt: z.string(),
  expiresAt: z.string(),
});
export type DeviceRequestEnvelope = z.infer<typeof DeviceRequestEnvelopeSchema>;

export const DeviceResponseEnvelopeSchema = z.object({
  requestId: z.string(),
  executionId: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  completedAt: z.string(),
});
export type DeviceResponseEnvelope = z.infer<typeof DeviceResponseEnvelopeSchema>;

export const DEVICE_REQUEST_TTL_MS = 45_000;
export const DEVICE_HEARTBEAT_STALE_MS = 45_000;
export const DEVICE_POLL_TIMEOUT_MS = 35_000;

/** Catalog of DESKTOP-environment tool ids (documentation + regression helpers). */
export const DESKTOP_TOOL_NAMES = [
  // Phase 4.0
  "get_connected_devices",
  "get_running_apps",
  "open_application",
  "open_url",
  "list_directory",
  "search_files",
  "read_file",
  "open_file",
  "open_folder",
  "create_folder",
  "copy_file",
  "move_file",
  "rename_file",
  // Phase 4.2 system
  "get_system_volume",
  "set_system_volume",
  "increase_system_volume",
  "decrease_system_volume",
  "mute_system_audio",
  "unmute_system_audio",
  "toggle_system_mute",
  "get_audio_output_devices",
  "get_audio_input_devices",
  "set_audio_output_device",
  "media_play_pause",
  "media_next",
  "media_previous",
  "media_stop",
  "get_current_media_session",
  "get_open_windows",
  "focus_window",
  "minimize_window",
  "maximize_window",
  "restore_window",
  "close_window",
  "move_window",
  "resize_window",
  "get_display_info",
  "get_battery_status",
  "get_power_status",
  "get_system_info",
  "get_network_status",
  "get_brightness",
  "set_brightness",
  "create_text_file",
  "write_text_file",
  "append_text_file",
  "duplicate_file",
  "delete_file",
  "delete_folder",
  "lock_pc",
  "sleep_pc",
  "restart_pc",
  "shutdown_pc",
  // Capability broker
  "get_clipboard_text",
  "set_clipboard_text",
  "clear_clipboard",
  "copy_image_to_clipboard",
  "capture_screenshot",
  "capture_monitor_screenshot",
  "capture_window_screenshot",
  "list_monitors",
  "get_window_bounds",
  "snap_window_left",
  "snap_window_right",
  "center_window",
  "bring_window_to_front",
  "move_window_to_monitor",
  "list_known_applications",
  "open_known_application",
  "focus_application",
  "close_application",
  "open_file_with_app",
  "find_newest_file",
  "find_largest_file",
  "find_files_by_date",
  "get_file_metadata",
  "reveal_in_explorer",
  "open_trusted_file",
  "list_processes",
  "terminate_process",
  "press_shortcut",
  "inspect_ui_elements",
  "invoke_ui_element",
  "set_ui_element_text",
  "show_notification",
  "open_search",
  "run_workspace_routine",
] as const;

export type DesktopToolName = (typeof DESKTOP_TOOL_NAMES)[number];

export function isDesktopToolName(name: string): boolean {
  return (DESKTOP_TOOL_NAMES as readonly string[]).includes(name);
}
