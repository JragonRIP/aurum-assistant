import { NextResponse } from "next/server";
import { z } from "zod";
import { isDeviceAuthError, requireDeviceAuth } from "@/lib/devices/auth";

export const dynamic = "force-dynamic";

const HeartbeatSchema = z.object({
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) return auth;

  const body = HeartbeatSchema.safeParse(await request.json().catch(() => ({})));
  const now = new Date().toISOString();

  const { error } = await auth.supabase
    .from("devices")
    .update({
      status: "online",
      last_seen_at: now,
      ...(body.success && body.data.appVersion
        ? { app_version: body.data.appVersion }
        : {}),
      ...(body.success && body.data.osVersion
        ? { os_version: body.data.osVersion }
        : {}),
    })
    .eq("id", auth.device.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: roots } = await auth.supabase
    .from("device_approved_roots")
    .select("id, label, canonical_path")
    .eq("device_id", auth.device.id);

  return NextResponse.json({
    ok: true,
    deviceId: auth.device.id,
    status: "online",
    approvedRoots: roots ?? [],
  });
}
