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

export const DESKTOP_TOOL_NAMES = [
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
] as const;

export type DesktopToolName = (typeof DESKTOP_TOOL_NAMES)[number];

export function isDesktopToolName(name: string): name is DesktopToolName {
  return (DESKTOP_TOOL_NAMES as readonly string[]).includes(name);
}
