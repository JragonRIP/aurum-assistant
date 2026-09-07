import { NextResponse } from "next/server";
import { isGeminiConfigured } from "@aurum/ai";
import { isDeviceAuthError, requireDeviceAuth } from "@/lib/devices/auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { synthesizeSpeech } from "@/lib/voice/tts";
import { getVoiceSettings } from "@/lib/voice/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) return auth;

  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Voice playback is not configured.", code: "ai_not_configured" },
      { status: 503 },
    );
  }

  const rate = checkRateLimit({
    key: `voice-tts-device:${auth.device.user_id}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many voice requests.", code: "rate_limited" },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    text?: string;
    voice?: string;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 4000) {
    return NextResponse.json({ error: "Invalid text." }, { status: 400 });
  }

  const settings = await getVoiceSettings(auth.supabase, auth.device.user_id);
  if (settings.spokenMode === "never") {
    return NextResponse.json(
      { error: "Spoken responses disabled.", code: "tts_disabled", skipped: true },
      { status: 200 },
    );
  }
  const voice = body?.voice?.trim() || settings.ttsVoice;

  try {
    const result = await synthesizeSpeech({ text, voice });
    if (
      settings.spokenMode === "short_only" &&
      result.speechText.length > 280
    ) {
      return NextResponse.json({
        skipped: true,
        speechText: result.speechText,
        code: "short_only_skip",
      });
    }
    console.info("[aurum:voice:tts:device]", {
      deviceIdPrefix: auth.device.id.slice(0, 8),
      latencyMs: result.latencyMs,
      model: result.model,
      voice: result.voice,
    });
    return NextResponse.json({
      audioBase64: result.audioBase64,
      mimeType: result.mimeType,
      speechText: result.speechText,
      latencyMs: result.latencyMs,
      provider: result.provider,
      model: result.model,
      voice: result.voice,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS failed";
    console.warn("[aurum:voice:tts:device]", { error: message.slice(0, 160) });
    return NextResponse.json(
      { error: "Voice playback unavailable.", code: "tts_failed" },
      { status: 502 },
    );
  }
}
