import { NextResponse } from "next/server";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";
import { verifySecret } from "@/lib/devices/crypto";
import type { DeviceRow } from "@/lib/devices/queries";

export type DeviceAuth = {
  device: DeviceRow;
  supabase: ReturnType<typeof createServiceClient>;
};

/**
 * Authorization: Bearer <deviceId>.<deviceSecret>
 */
export async function requireDeviceAuth(
  request: Request,
): Promise<DeviceAuth | NextResponse> {
  if (!hasServiceRole()) {
    return NextResponse.json(
      { error: "Device bridge not configured" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = match[1]!;
  const dot = token.indexOf(".");
  if (dot <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deviceId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!deviceId || !secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("devices")
    .select(
      "id, user_id, device_type, name, status, is_online, last_seen_at, app_version, platform, os_version, credential_hash, is_default",
    )
    .eq("id", deviceId)
    .maybeSingle();

  if (error || !data?.credential_hash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (data.status === "disabled") {
    return NextResponse.json({ error: "Device revoked" }, { status: 403 });
  }
  if (!verifySecret(secret, String(data.credential_hash))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { device: data as DeviceRow, supabase };
}

export function isDeviceAuthError(
  value: DeviceAuth | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}
