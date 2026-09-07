import { NextResponse } from "next/server";
import {
  AIProviderError,
  classifyProviderError,
  isGeminiConfigured,
} from "@aurum/ai";
import { isAuthError, requireAuth } from "@/lib/auth";
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
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "Voice playback is not configured.", code: "ai_not_configured" },
      { status: 503 },
    );
  }

  const rate = checkRateLimit({
    key: `voice-tts:${auth.user.id}`,
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

  const settings = await getVoiceSettings(auth.supabase, auth.user.id);
  const voice = body?.voice?.trim() || settings.ttsVoice;

  try {
    const result = await synthesizeSpeech({
      text,
      voice,
      signal: request.signal,
    });
    console.info("[aurum:voice:tts]", {
      userIdPrefix: auth.user.id.slice(0, 8),
      latencyMs: result.latencyMs,
      model: result.model,
      primaryModel: result.primaryModel,
      fallbackUsed: result.fallbackUsed,
      attemptsTotal: result.attemptsTotal,
      voice: result.voice,
      speechChars: result.speechText.length,
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
    });
  } catch (err) {
    const classified =
      err instanceof AIProviderError
        ? err
        : classifyProviderError(err, "gemini");
    const status = httpStatusForTtsError(classified);
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
    console.warn("[aurum:voice:tts]", {
      userIdPrefix: auth.user.id.slice(0, 8),
      provider_error_class: providerErrorClassFor(classified),
      httpStatus: status,
      circuit_open: extras.circuitOpen ?? false,
      quota_metric: extras.quotaInfo?.quotaMetric ?? null,
      quota_id: extras.quotaInfo?.quotaId ?? null,
      retry_after_ms: retryAfterMs,
      error: classified.message.slice(0, 160),
    });
    return NextResponse.json(
      {
        error: "Voice playback unavailable.",
        code: classified.code ?? "tts_failed",
        providerErrorClass: providerErrorClassFor(classified),
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
