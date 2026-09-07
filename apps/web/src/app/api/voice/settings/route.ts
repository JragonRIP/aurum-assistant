import { NextResponse } from "next/server";
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_SPOKEN_MODE,
  type VoiceSpokenMode,
} from "@aurum/shared";
import { isAuthError, requireAuth } from "@/lib/auth";
import { getVoiceSettings, upsertVoiceSettings } from "@/lib/voice/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const settings = await getVoiceSettings(auth.supabase, auth.user.id);
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const patch: Parameters<typeof upsertVoiceSettings>[2] = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (
    typeof body.spokenMode === "string" &&
    (VOICE_SPOKEN_MODE as readonly string[]).includes(body.spokenMode)
  ) {
    patch.spokenMode = body.spokenMode as VoiceSpokenMode;
  }
  if (typeof body.ttsVoice === "string" && body.ttsVoice.trim()) {
    patch.ttsVoice = body.ttsVoice.trim().slice(0, 64);
  }
  if (body.inputDeviceId === null || typeof body.inputDeviceId === "string") {
    patch.inputDeviceId =
      body.inputDeviceId === null ? null : String(body.inputDeviceId).slice(0, 200);
  }
  if (body.outputDeviceId === null || typeof body.outputDeviceId === "string") {
    patch.outputDeviceId =
      body.outputDeviceId === null
        ? null
        : String(body.outputDeviceId).slice(0, 200);
  }

  try {
    const settings = await upsertVoiceSettings(
      auth.supabase,
      auth.user.id,
      patch,
    );
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to save",
        settings: DEFAULT_VOICE_SETTINGS,
      },
      { status: 400 },
    );
  }
}
