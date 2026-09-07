import { NextResponse } from "next/server";
import {
  AIProviderError,
  buildSpeechResponse,
  classifyProviderError,
  isGeminiConfigured,
} from "@aurum/ai";
import { shouldSpeakResponse } from "@aurum/shared";
import { isDeviceAuthError, requireDeviceAuth } from "@/lib/devices/auth";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import {
  httpStatusForTtsError,
  providerErrorClassFor,
  getTtsFailureExtras,
  synthesizeSpeech,
} from "@/lib/voice/tts";
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
    /** Temporary diagnostic: skip spoken_mode / enabled gates for Test Voice. */
    bypassSpokenMode?: boolean;
    /** Eligibility only — no provider TTS (used by local Kokoro path). */
    previewOnly?: boolean;
  } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 4000) {
    return NextResponse.json({ error: "Invalid text." }, { status: 400 });
  }

  const settings = await getVoiceSettings(auth.supabase, auth.device.user_id);
  const bypass = body?.bypassSpokenMode === true;
  const previewOnly = body?.previewOnly === true;
  const speechCandidate = buildSpeechResponse(text);

  if (!bypass) {
    if (!settings.enabled || settings.spokenMode === "never") {
      return NextResponse.json(
        {
          error: "Spoken responses disabled.",
          code: "tts_disabled",
          skipped: true,
          spokenMode: settings.spokenMode,
          voiceEnabled: settings.enabled,
        },
        { status: 200 },
      );
    }

    if (
      !shouldSpeakResponse({
        inputMode: "voice",
        spokenMode: settings.spokenMode,
        speechText: speechCandidate,
      })
    ) {
      console.info("[aurum:voice:tts:device]", {
        stage: "skip",
        code:
          settings.spokenMode === "short_only"
            ? "short_only_skip"
            : "tts_skipped",
        spokenMode: settings.spokenMode,
        speechTextLen: speechCandidate.length,
        deviceIdPrefix: auth.device.id.slice(0, 8),
      });
      return NextResponse.json({
        skipped: true,
        speechText: speechCandidate,
        spokenMode: settings.spokenMode,
        voiceEnabled: settings.enabled,
        code:
          settings.spokenMode === "short_only"
            ? "short_only_skip"
            : "tts_skipped",
      });
    }
  }

  if (previewOnly) {
    return NextResponse.json({
      skipped: false,
      speechText: speechCandidate,
      spokenMode: settings.spokenMode,
      voiceEnabled: settings.enabled,
      previewOnly: true,
    });
  }

  const voice = body?.voice?.trim() || settings.ttsVoice;

  try {
    const result = await synthesizeSpeech({
      text,
      voice,
      signal: request.signal,
    });
    console.info("[aurum:voice:tts:device]", {
      stage: "ok",
      deviceIdPrefix: auth.device.id.slice(0, 8),
      latencyMs: result.latencyMs,
      model: result.model,
      primaryModel: result.primaryModel,
      fallbackModel: result.fallbackModel,
      fallbackUsed: result.fallbackUsed,
      attemptsTotal: result.attemptsTotal,
      voice: result.voice,
      mimeType: result.mimeType?.split(";")[0] ?? null,
      audioBytesApprox: Math.floor((result.audioBase64?.length ?? 0) * 0.75),
      speechTextLen: result.speechText.length,
      bypassSpokenMode: bypass,
      spokenMode: settings.spokenMode,
      voiceEnabled: settings.enabled,
    });
    return NextResponse.json({
      audioBase64: result.audioBase64,
      mimeType: result.mimeType,
      speechText: result.speechText,
      latencyMs: result.latencyMs,
      provider: result.provider,
      model: result.model,
      voice: result.voice,
      primaryModel: result.primaryModel,
      fallbackModel: result.fallbackModel,
      fallbackUsed: result.fallbackUsed,
      attemptsTotal: result.attemptsTotal,
      circuitHit: Boolean(result.circuitHit),
      spokenMode: settings.spokenMode,
      voiceEnabled: settings.enabled,
      bypassSpokenMode: bypass,
    });
  } catch (err) {
    const classified =
      err instanceof AIProviderError
        ? err
        : classifyProviderError(err, "gemini");
    const status = httpStatusForTtsError(classified);
    const providerErrorClass = providerErrorClassFor(classified);
    const extras = getTtsFailureExtras(err);
    const retryAfterMs = extras.quotaInfo?.retryDelayMs ?? null;
    const headers =
      status === 429 && retryAfterMs != null && retryAfterMs > 0
        ? {
            "Retry-After": String(
              Math.min(86_400, Math.max(1, Math.ceil(retryAfterMs / 1000))),
            ),
          }
        : undefined;
    console.warn("[aurum:voice:tts:device]", {
      stage: "error",
      code: classified.code ?? "tts_failed",
      provider_error_class: providerErrorClass,
      httpStatus: status,
      upstreamStatus: classified.httpStatus ?? null,
      circuit_open: extras.circuitOpen ?? false,
      quota_metric: extras.quotaInfo?.quotaMetric ?? null,
      quota_id: extras.quotaInfo?.quotaId ?? null,
      quota_model: extras.quotaInfo?.model ?? null,
      quota_limit: extras.quotaInfo?.limit ?? null,
      retry_after_ms: retryAfterMs,
      is_daily_quota: extras.quotaInfo?.isDailyQuota ?? null,
      error: classified.message.slice(0, 160),
    });
    return NextResponse.json(
      {
        error: "Voice playback unavailable.",
        code: classified.code ?? "tts_failed",
        providerErrorClass,
        circuitOpen: extras.circuitOpen ?? false,
        quotaMetric: extras.quotaInfo?.quotaMetric ?? null,
        quotaId: extras.quotaInfo?.quotaId ?? null,
        quotaModel: extras.quotaInfo?.model ?? null,
        quotaLimit: extras.quotaInfo?.limit ?? null,
        retryAfterMs,
        isDailyQuota: extras.quotaInfo?.isDailyQuota ?? null,
      },
      { status, headers },
    );
  }
}
