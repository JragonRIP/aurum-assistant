import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";
import {
  generateDeviceSecret,
  hashPairingCode,
  hashSecret,
} from "@/lib/devices/crypto";

export const dynamic = "force-dynamic";

const PairSchema = z.object({
  code: z.string().min(6).max(16),
  deviceName: z.string().min(1).max(80).optional(),
  platform: z.string().max(40).optional(),
  osVersion: z.string().max(80).optional(),
  appVersion: z.string().max(40).optional(),
});

/**
 * Desktop consumes a one-time pairing code → device credential.
 * Public API (no user cookie); code proves user intent.
 */
export async function POST(request: Request) {
  if (!hasServiceRole()) {
    return NextResponse.json(
      { error: "Device bridge not configured (missing service role key)" },
      { status: 503 },
    );
  }

  const parsed = PairSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid pairing payload" }, { status: 400 });
  }

  const code = parsed.data.code.trim().toUpperCase();
  const codeHash = hashPairingCode(code);
  const supabase = createServiceClient();

  const { data: token, error } = await supabase
    .from("device_pairing_tokens")
    .select("id, user_id, expires_at, consumed_at")
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .maybeSingle();

  if (error || !token) {
    return NextResponse.json({ error: "Invalid pairing code" }, { status: 401 });
  }
  if (Date.parse(String(token.expires_at)) < Date.now()) {
    return NextResponse.json({ error: "Pairing code expired" }, { status: 401 });
  }

  const { data: consumed, error: consumeError } = await supabase
    .from("device_pairing_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", token.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();

  if (consumeError || !consumed) {
    return NextResponse.json(
      { error: "Pairing code already used" },
      { status: 409 },
    );
  }

  const secret = generateDeviceSecret();
  const deviceName =
    parsed.data.deviceName?.trim() ||
    `Windows PC`;

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .insert({
      user_id: token.user_id,
      device_type: "WINDOWS_DESKTOP",
      name: deviceName,
      platform: parsed.data.platform ?? "win32",
      os_version: parsed.data.osVersion ?? null,
      app_version: parsed.data.appVersion ?? "0.4.0",
      status: "offline",
      credential_hash: hashSecret(secret),
      is_default: true,
    })
    .select("id, name")
    .single();

  if (deviceError || !device) {
    return NextResponse.json(
      { error: deviceError?.message ?? "Could not create device" },
      { status: 500 },
    );
  }

  // Prefer this device as default
  await supabase
    .from("devices")
    .update({ is_default: false })
    .eq("user_id", token.user_id)
    .neq("id", device.id);

  await supabase
    .from("devices")
    .update({ is_default: true })
    .eq("id", device.id);

  return NextResponse.json({
    deviceId: device.id,
    deviceName: device.name,
    deviceSecret: secret,
    webUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });
}
