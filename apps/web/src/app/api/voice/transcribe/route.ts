import { NextResponse } from "next/server";
import {
  VOICE_MAX_UPLOAD_BYTES,
  VOICE_MIN_AUDIO_BYTES,
} from "@aurum/shared";
import { isGeminiConfigured } from "@aurum/ai";
import { isAuthError, requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { transcribeAudio } from "@/lib/voice/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Voice transcription is not configured.", code: "ai_not_configured" },
      { status: 503 },
    );
  }

  const rate = checkRateLimit({
    key: `voice-stt:${auth.user.id}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many voice requests.", code: "rate_limited" },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body." }, { status: 400 });
  }

  const file = form.get("audio");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing audio file." }, { status: 400 });
  }
  if (file.size > VOICE_MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Audio too large.", code: "too_large" }, { status: 413 });
  }
  if (file.size < VOICE_MIN_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "I didn't catch that.", code: "EMPTY_AUDIO", transcript: "" },
      { status: 400 },
    );
  }

  const mimeType = file.type || "audio/webm";
  if (!/^audio\//i.test(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported audio type.", code: "UNSUPPORTED_AUDIO_FORMAT" },
      { status: 415 },
    );
  }

  const started = Date.now();
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await transcribeAudio({ bytes: buf, mimeType });
    console.info("[aurum:voice:stt]", {
      userIdPrefix: auth.user.id.slice(0, 8),
      bytes: buf.length,
      mimeType,
      latencyMs: result.latencyMs,
      model: result.model,
      source: result.source,
      transcriptLen: result.transcript.length,
      empty: !result.transcript,
      totalMs: Date.now() - started,
    });
    if (!result.transcript) {
      return NextResponse.json(
        {
          error: "I didn't catch that.",
          code: "NO_SPEECH_DETECTED",
          transcript: "",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({
      transcript: result.transcript,
      latencyMs: result.latencyMs,
      provider: result.provider,
      model: result.model,
      source: result.source,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    console.warn("[aurum:voice:stt]", {
      userIdPrefix: auth.user.id.slice(0, 8),
      code: "STT_PROVIDER_ERROR",
      error: message.slice(0, 160),
    });
    return NextResponse.json(
      { error: "Transcription unavailable.", code: "STT_PROVIDER_ERROR" },
      { status: 502 },
    );
  }
}
