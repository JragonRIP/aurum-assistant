import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolErrorCode, ToolResult } from "@aurum/tools";
import { DEVICE_POLL_TIMEOUT_MS } from "@aurum/shared";
import {
  createDeviceRequest,
  getOnlineWindowsDevice,
  waitForDeviceResult,
} from "./queries";

export async function dispatchDeviceTool(opts: {
  supabase: SupabaseClient;
  userId: string;
  tool: string;
  input: Record<string, unknown>;
  executionId: string;
  signal?: AbortSignal;
  log?: (event: Record<string, unknown>) => void;
}): Promise<ToolResult> {
  const device = await getOnlineWindowsDevice(opts.supabase, opts.userId);
  if (!device) {
    return {
      success: false,
      error: {
        code: "DEVICE_OFFLINE",
        message: "Your Windows device isn't connected.",
      },
      activityLabel: "Device offline",
    };
  }

  const t0 = Date.now();
  opts.log?.({
    event: "device_request_dispatch",
    tool: opts.tool,
    deviceId: device.id,
    executionId: opts.executionId,
  });

  await createDeviceRequest({
    supabase: opts.supabase,
    userId: opts.userId,
    deviceId: device.id,
    tool: opts.tool,
    executionId: opts.executionId,
    payload: opts.input,
  });

  const response = await waitForDeviceResult({
    supabase: opts.supabase,
    deviceId: device.id,
    executionId: opts.executionId,
    timeoutMs: DEVICE_POLL_TIMEOUT_MS,
    signal: opts.signal,
  });

  opts.log?.({
    event: "device_request_complete",
    tool: opts.tool,
    deviceId: device.id,
    success: response.success,
    durationMs: Date.now() - t0,
    error: response.error?.code,
  });

  if (!response.success) {
    const code = (response.error?.code ?? "EXECUTION_FAILED") as ToolErrorCode;
    return {
      success: false,
      error: {
        code,
        message:
          response.error?.message ?? "Windows device action failed.",
      },
      activityLabel: "Device action failed",
      metadata: { deviceId: device.id, durationMs: Date.now() - t0 },
    };
  }

  const data = response.data as Record<string, unknown> | undefined;
  return {
    success: true,
    data,
    message:
      typeof data?.message === "string"
        ? data.message
        : "Completed on Windows device.",
    activityLabel:
      typeof data?.activityLabel === "string"
        ? data.activityLabel
        : "Device action",
    metadata: {
      deviceId: device.id,
      durationMs: Date.now() - t0,
      surface: data?.surface,
    },
  };
}
