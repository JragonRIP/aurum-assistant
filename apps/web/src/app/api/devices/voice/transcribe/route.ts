import { NextResponse } from "next/server";
import {
  VOICE_MAX_UPLOAD_BYTES,
  VOICE_MIN_AUDIO_BYTES,
} from "@aurum/shared";
import { isGeminiConfigured } from "@aurum/ai";
import { isDeviceAuthError, requireDeviceAuth } from "@/lib/devices/auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import { transcribeAudio } from "@/lib/voice/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireDeviceAuth(request);
  if (isDeviceAuthError(auth)) return auth;

  if (!isGeminiConfigured()) {
    return NextResponse.json(
      {
        error: "Voice transcription is not configured.",
        code: "ai_not_configured",
      },
      { status: 503 },
    );
  }

  const rate = checkRateLimit({
    key: `voice-stt-device:${auth.device.user_id}`,
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
    return NextResponse.json(
      { error: "Invalid multipart body.", code: "INVALID_MULTIPART" },
      { status: 400 },
    );
  }

  const file = form.get("audio");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "Missing audio file.", code: "MISSING_AUDIO" },
      { status: 400 },
    );
  }
  const blob = file as Blob;
  if (blob.size > VOICE_MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Audio too large.", code: "too_large" },
      { status: 413 },
    );
  }
  if (blob.size < VOICE_MIN_AUDIO_BYTES) {
    console.info("[aurum:voice:stt:device]", {
      code: "EMPTY_AUDIO",
      bytes: blob.size,
      mimeType: blob.type || null,
    });
    return NextResponse.json(
      {
        error: "I didn't catch that.",
        code: "EMPTY_AUDIO",
        transcript: "",
      },
      { status: 400 },
    );
  }

  const mimeType = blob.type || "audio/webm";
  if (!/^audio\//i.test(mimeType) && !mimeType.includes("webm") && !mimeType.includes("ogg")) {
    // Some Electron builds omit type — still accept if field present; STT normalizes.
    if (mimeType && !/^application\/octet-stream$/i.test(mimeType)) {
      return NextResponse.json(
        { error: "Unsupported audio type.", code: "UNSUPPORTED_AUDIO_FORMAT" },
        { status: 415 },
      );
    }
  }

  try {
    const buf = Buffer.from(await blob.arrayBuffer());
    console.info("[aurum:voice:stt:device]", {
      stage: "received",
      deviceIdPrefix: auth.device.id.slice(0, 8),
      bytes: buf.length,
      mimeType: mimeType || null,
      contentType: request.headers.get("content-type")?.split(";")[0] ?? null,
    });
    const result = await transcribeAudio({ bytes: buf, mimeType: mimeType || "audio/webm" });
    console.info("[aurum:voice:stt:device]", {
      stage: "result",
      deviceIdPrefix: auth.device.id.slice(0, 8),
      bytes: buf.length,
      mimeType,
      model: result.model,
      source: result.source,
      transcriptLen: result.transcript.length,
      empty: !result.transcript,
      latencyMs: result.latencyMs,
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
    console.warn("[aurum:voice:stt:device]", {
      code: "STT_PROVIDER_ERROR",
      error: message.slice(0, 200),
    });
    return NextResponse.json(
      {
        error: "Transcription unavailable.",
        code: "STT_PROVIDER_ERROR",
      },
      { status: 502 },
    );
  }
}
