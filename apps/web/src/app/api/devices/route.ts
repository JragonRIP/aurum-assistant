import { NextResponse } from "next/server";
import { isAuthError, requireAuth } from "@/lib/auth";
import {
  generatePairingCode,
  hashPairingCode,
  pairingCodeHint,
} from "@/lib/devices/crypto";
import { listUserDevices, isDeviceHeartbeatFresh } from "@/lib/devices/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  try {
    const devices = await listUserDevices(auth.supabase, auth.user.id);
    return NextResponse.json({
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        device_type: d.device_type,
        platform: d.platform,
        os_version: d.os_version,
        app_version: d.app_version,
        status:
          d.status === "disabled"
            ? "disabled"
            : isDeviceHeartbeatFresh(d.last_seen_at)
              ? "online"
              : "offline",
        last_seen_at: d.last_seen_at,
        is_default: d.is_default,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list devices" },
      { status: 500 },
    );
  }
}

/** Create a short-lived pairing code */
export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
  };

  if (body.action === "pair") {
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const { data, error } = await auth.supabase
      .from("device_pairing_tokens")
      .insert({
        user_id: auth.user.id,
        code_hash: hashPairingCode(code),
        code_hint: pairingCodeHint(code),
        expires_at: expiresAt.toISOString(),
      })
      .select("id, expires_at, code_hint")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Could not create pairing code" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      pairingId: data.id,
      code,
      codeHint: data.code_hint,
      expiresAt: data.expires_at,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
