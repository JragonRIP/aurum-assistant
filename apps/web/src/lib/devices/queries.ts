import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEVICE_HEARTBEAT_STALE_MS,
  DEVICE_REQUEST_TTL_MS,
  type DeviceRequestEnvelope,
  type DeviceResponseEnvelope,
} from "@aurum/shared";
import { randomUUID } from "node:crypto";

export type DeviceRow = {
  id: string;
  user_id: string;
  device_type: string;
  name: string;
  status: string;
  is_online: boolean;
  last_seen_at: string | null;
  app_version: string | null;
  platform: string | null;
  os_version: string | null;
  credential_hash: string | null;
  is_default: boolean;
};

export async function listUserDevices(
  supabase: SupabaseClient,
  userId: string,
): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from("devices")
    .select(
      "id, user_id, device_type, name, status, is_online, last_seen_at, app_version, platform, os_version, credential_hash, is_default",
    )
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceRow[];
}

export function isDeviceHeartbeatFresh(
  lastSeenAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return false;
  return now - t <= DEVICE_HEARTBEAT_STALE_MS;
}

export async function getOnlineWindowsDevice(
  supabase: SupabaseClient,
  userId: string,
): Promise<DeviceRow | null> {
  const devices = await listUserDevices(supabase, userId);
  const windows = devices.filter(
    (d) =>
      d.device_type === "WINDOWS_DESKTOP" &&
      d.status !== "disabled" &&
      isDeviceHeartbeatFresh(d.last_seen_at),
  );
  if (windows.length === 0) return null;
  const preferred = windows.find((d) => d.is_default) ?? windows[0]!;
  return preferred;
}

export async function createDeviceRequest(opts: {
  supabase: SupabaseClient;
  userId: string;
  deviceId: string;
  tool: string;
  executionId: string;
  payload: Record<string, unknown>;
  ttlMs?: number;
}): Promise<DeviceRequestEnvelope> {
  const requestId = randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (opts.ttlMs ?? DEVICE_REQUEST_TTL_MS));

  const { error } = await opts.supabase.from("device_requests").insert({
    user_id: opts.userId,
    device_id: opts.deviceId,
    request_id: requestId,
    execution_id: opts.executionId,
    tool_name: opts.tool,
    payload: opts.payload,
    status: "pending",
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    // Idempotent replay — return existing
    if (/duplicate|unique/i.test(error.message)) {
      const { data } = await opts.supabase
        .from("device_requests")
        .select("*")
        .eq("device_id", opts.deviceId)
        .eq("execution_id", opts.executionId)
        .maybeSingle();
      if (data) {
        return {
          requestId: String(data.request_id),
          deviceId: opts.deviceId,
          tool: String(data.tool_name),
          executionId: opts.executionId,
          payload: (data.payload ?? {}) as Record<string, unknown>,
          issuedAt: String(data.issued_at),
          expiresAt: String(data.expires_at),
        };
      }
    }
    throw new Error(error.message);
  }

  return {
    requestId,
    deviceId: opts.deviceId,
    tool: opts.tool,
    executionId: opts.executionId,
    payload: opts.payload,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function waitForDeviceResult(opts: {
  supabase: SupabaseClient;
  deviceId: string;
  executionId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<DeviceResponseEnvelope> {
  const started = Date.now();
  while (Date.now() - started < opts.timeoutMs) {
    if (opts.signal?.aborted) {
      await opts.supabase
        .from("device_requests")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_code: "CANCELLED",
          error_message: "Cancelled",
        })
        .eq("device_id", opts.deviceId)
        .eq("execution_id", opts.executionId)
        .eq("status", "pending");
      return {
        requestId: "",
        executionId: opts.executionId,
        success: false,
        error: { code: "CANCELLED", message: "Cancelled" },
        completedAt: new Date().toISOString(),
      };
    }

    const { data, error } = await opts.supabase
      .from("device_requests")
      .select("*")
      .eq("device_id", opts.deviceId)
      .eq("execution_id", opts.executionId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) {
      const expires = Date.parse(String(data.expires_at));
      if (
        data.status === "pending" &&
        !Number.isNaN(expires) &&
        Date.now() > expires
      ) {
        await opts.supabase
          .from("device_requests")
          .update({
            status: "expired",
            completed_at: new Date().toISOString(),
            error_code: "REQUEST_EXPIRED",
            error_message: "Device request expired.",
          })
          .eq("id", data.id)
          .eq("status", "pending");
        return {
          requestId: String(data.request_id),
          executionId: opts.executionId,
          success: false,
          error: {
            code: "REQUEST_EXPIRED",
            message: "Device request expired.",
          },
          completedAt: new Date().toISOString(),
        };
      }

      if (
        data.status === "succeeded" ||
        data.status === "failed" ||
        data.status === "cancelled" ||
        data.status === "expired"
      ) {
        return {
          requestId: String(data.request_id),
          executionId: opts.executionId,
          success: data.status === "succeeded",
          data: data.result ?? undefined,
          error:
            data.status === "succeeded"
              ? undefined
              : {
                  code: String(data.error_code ?? "EXECUTION_FAILED"),
                  message: String(
                    data.error_message ?? "Device tool failed.",
                  ),
                },
          completedAt: String(
            data.completed_at ?? new Date().toISOString(),
          ),
        };
      }
    }

    await sleep(350);
  }

  return {
    requestId: "",
    executionId: opts.executionId,
    success: false,
    error: {
      code: "DEVICE_TIMEOUT",
      message: "Windows device did not respond in time.",
    },
    completedAt: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
