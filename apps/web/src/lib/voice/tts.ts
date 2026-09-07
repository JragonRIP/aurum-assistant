/**
 * Text-to-speech via Gemini TTS (server-side only).
 * Retries transient provider failures within a hard latency budget,
 * then one official fallback TTS model if time remains.
 */
import {
  AIProviderError,
  buildSpeechResponse,
  classifyProviderError,
  getTtsFallbackModel,
  getTtsModel,
  getTtsVoice,
  isGeminiConfigured,
  MAX_TTS_RETRIES,
  sleepWithSignal,
  TTS_RATE_LIMIT_DEFAULT_BACKOFF_MS,
  TTS_RATE_LIMIT_MAX_BACKOFF_MS,
  TTS_RETRY_DELAYS_MS,
  TTS_TOTAL_BUDGET_MS,
} from "@aurum/ai";
import { getGeminiClient } from "@/lib/ai/gemini-client";

export type SpeechResult = {
  /** base64 PCM or wav payload */
  audioBase64: string;
  mimeType: string;
  speechText: string;
  latencyMs: number;
  provider: "gemini";
  model: string;
  voice: string;
  primaryModel: string;
  fallbackModel: string | null;
  fallbackUsed: boolean;
  attemptsTotal: number;
};

export type TtsProviderErrorClass =
  | "transient"
  | "auth"
  | "invalid_request"
  | "cancelled"
  | "no_audio"
  | "rate_limited"
  | "budget_exhausted"
  | "unknown";

export function httpStatusForTtsError(err: AIProviderError): number {
  if (err.kind === "auth") return err.httpStatus === 403 ? 403 : 401;
  if (err.kind === "invalid_request") return 400;
  if (err.kind === "cancelled") {
    return err.code === "budget_exhausted" ? 504 : 499;
  }
  if (err.httpStatus === 429) return 429;
  if (err.httpStatus === 503) return 503;
  if (err.httpStatus === 504) return 504;
  return 502;
}

export function providerErrorClassFor(
  err: AIProviderError,
): TtsProviderErrorClass {
  if (err.code === "no_audio") return "no_audio";
  if (err.code === "budget_exhausted") return "budget_exhausted";
  if (err.httpStatus === 429) return "rate_limited";
  return err.kind;
}

/** Parse Retry-After (seconds or HTTP-date) into milliseconds; null if absent. */
export function parseRetryAfterMs(err: unknown): number | null {
  const obj =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const headers = obj?.headers as
    | { get?: (k: string) => string | null }
    | Record<string, string>
    | undefined;
  let raw: string | null = null;
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    raw = (headers as { get: (k: string) => string | null }).get("retry-after");
  } else if (headers && typeof headers === "object") {
    const rec = headers as Record<string, string>;
    raw = rec["retry-after"] ?? rec["Retry-After"] ?? null;
  }
  if (!raw && err instanceof Error) {
    const m = err.message.match(/retry[- ]after[:\s]+(\d+)/i);
    if (m?.[1]) raw = m[1];
  }
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) {
    return Math.round(asNum * 1000);
  }
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    return Math.max(0, when - Date.now());
  }
  return null;
}

export function rateLimitBackoffMs(err: AIProviderError): number {
  const hinted = parseRetryAfterMs(err.cause ?? err);
  const base =
    hinted != null && hinted > 0 ? hinted : TTS_RATE_LIMIT_DEFAULT_BACKOFF_MS;
  return Math.min(base, TTS_RATE_LIMIT_MAX_BACKOFF_MS);
}

function remainingBudgetMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now());
}

function assertBudget(deadlineMs: number, signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AIProviderError({
      message: "Request cancelled",
      kind: "cancelled",
      provider: "gemini",
      retryable: false,
      code: "cancelled",
    });
  }
  if (remainingBudgetMs(deadlineMs) <= 0) {
    throw new AIProviderError({
      message: "TTS latency budget exhausted",
      kind: "cancelled",
      provider: "gemini",
      retryable: false,
      code: "budget_exhausted",
    });
  }
}

async function generateOnce(opts: {
  model: string;
  speechText: string;
  voice: string;
  signal?: AbortSignal;
}): Promise<{ audioBase64: string; mimeType: string }> {
  if (opts.signal?.aborted) {
    throw new AIProviderError({
      message: "Request cancelled",
      kind: "cancelled",
      provider: "gemini",
      retryable: false,
      code: "cancelled",
    });
  }

  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model: opts.model,
    contents: opts.speechText,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: opts.voice,
          },
        },
      },
    } as Record<string, unknown>,
  });

  const inline = extractInlineAudio(response);
  if (!inline) {
    throw new AIProviderError({
      message: "TTS returned no audio",
      kind: "transient",
      provider: "gemini",
      retryable: true,
      code: "no_audio",
    });
  }
  return {
    audioBase64: inline.data,
    mimeType: inline.mimeType || "audio/L16;rate=24000",
  };
}

async function runModelWithBudget(opts: {
  model: string;
  label: "primary" | "fallback";
  speechText: string;
  voice: string;
  signal?: AbortSignal;
  deadlineMs: number;
  onAttemptCounted: () => void;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const maxAttempts = MAX_TTS_RETRIES + 1;
  let lastError: AIProviderError | null = null;
  let rateLimitRetries = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    assertBudget(opts.deadlineMs, opts.signal);
    opts.onAttemptCounted();
    const attemptStarted = Date.now();
    try {
      const audio = await generateOnce({
        model: opts.model,
        speechText: opts.speechText,
        voice: opts.voice,
        signal: opts.signal,
      });
      console.info("[aurum:voice:tts]", {
        stage: "attempt_ok",
        purpose: opts.label,
        attempt,
        model: opts.model,
        status: 200,
        latency_ms: Date.now() - attemptStarted,
        provider_error_class: null,
        retrying: false,
        audio_bytes: Math.floor(audio.audioBase64.length * 0.75),
        mime: audio.mimeType.split(";")[0] || null,
        budget_remaining_ms: remainingBudgetMs(opts.deadlineMs),
      });
      return audio;
    } catch (err) {
      const classified =
        err instanceof AIProviderError
          ? err
          : classifyProviderError(err, "gemini");
      lastError = classified;
      const is429 = classified.httpStatus === 429;
      const retryAfterMs = is429 ? rateLimitBackoffMs(classified) : null;

      let willRetry =
        classified.retryable &&
        attempt < maxAttempts &&
        !opts.signal?.aborted &&
        classified.kind !== "cancelled";

      // 429: at most one rate-limit retry, with conservative / Retry-After backoff.
      if (is429) {
        if (rateLimitRetries >= 1) willRetry = false;
        else rateLimitRetries += 1;
      }

      const delayMs = willRetry
        ? is429
          ? (retryAfterMs ?? TTS_RATE_LIMIT_DEFAULT_BACKOFF_MS)
          : (TTS_RETRY_DELAYS_MS[attempt - 1] ??
            TTS_RETRY_DELAYS_MS[TTS_RETRY_DELAYS_MS.length - 1]!)
        : null;

      if (
        willRetry &&
        delayMs != null &&
        remainingBudgetMs(opts.deadlineMs) <= delayMs + 500
      ) {
        willRetry = false;
      }

      console.warn("[aurum:voice:tts]", {
        stage: "attempt",
        purpose: opts.label,
        attempt,
        model: opts.model,
        status: classified.httpStatus ?? null,
        latency_ms: Date.now() - attemptStarted,
        provider_error_class: providerErrorClassFor(classified),
        retrying: willRetry,
        retry_after_ms: retryAfterMs,
        delay_ms: delayMs,
        budget_remaining_ms: remainingBudgetMs(opts.deadlineMs),
      });

      if (!willRetry || delayMs == null) {
        throw classified;
      }

      await sleepWithSignal(delayMs, opts.signal);
    }
  }

  throw (
    lastError ??
    new AIProviderError({
      message: "TTS failed",
      kind: "unknown",
      provider: "gemini",
      retryable: false,
    })
  );
}

export async function synthesizeSpeech(opts: {
  text: string;
  voice?: string;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  if (!isGeminiConfigured()) {
    throw new AIProviderError({
      message: "Voice synthesis is not configured.",
      kind: "invalid_request",
      provider: "gemini",
      retryable: false,
      code: "ai_not_configured",
    });
  }
  const speechText = buildSpeechResponse(opts.text);
  if (!speechText) {
    throw new AIProviderError({
      message: "Nothing to speak.",
      kind: "invalid_request",
      provider: "gemini",
      retryable: false,
      code: "empty_speech",
    });
  }

  const primaryModel = getTtsModel(process.env);
  const fallbackModel = getTtsFallbackModel(process.env);
  const voice = opts.voice?.trim() || getTtsVoice(process.env);
  const started = Date.now();
  const deadlineMs = started + TTS_TOTAL_BUDGET_MS;
  let attemptsTotal = 0;

  const run = (model: string, label: "primary" | "fallback") =>
    runModelWithBudget({
      model,
      label,
      speechText,
      voice,
      signal: opts.signal,
      deadlineMs,
      onAttemptCounted: () => {
        attemptsTotal += 1;
      },
    });

  try {
    const audio = await run(primaryModel, "primary");
    return {
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
      speechText,
      latencyMs: Date.now() - started,
      provider: "gemini",
      model: primaryModel,
      voice,
      primaryModel,
      fallbackModel,
      fallbackUsed: false,
      attemptsTotal,
    };
  } catch (primaryErr) {
    const classified =
      primaryErr instanceof AIProviderError
        ? primaryErr
        : classifyProviderError(primaryErr, "gemini");

    const canFallback =
      Boolean(fallbackModel) &&
      classified.retryable &&
      classified.kind !== "cancelled" &&
      classified.kind !== "auth" &&
      classified.kind !== "invalid_request" &&
      classified.httpStatus !== 429 &&
      !opts.signal?.aborted &&
      remainingBudgetMs(deadlineMs) >= 1_500;

    if (!canFallback || !fallbackModel) {
      console.warn("[aurum:voice:tts]", {
        stage: "final_failure",
        primary_model: primaryModel,
        fallback_model: fallbackModel,
        fallback_attempted: false,
        attempts_total: attemptsTotal,
        provider_error_class: providerErrorClassFor(classified),
        final_status: classified.httpStatus ?? null,
        budget_remaining_ms: remainingBudgetMs(deadlineMs),
      });
      throw classified;
    }

    console.info("[aurum:voice:tts]", {
      stage: "fallback_start",
      primary_model: primaryModel,
      fallback_model: fallbackModel,
      budget_remaining_ms: remainingBudgetMs(deadlineMs),
    });

    try {
      const audio = await run(fallbackModel, "fallback");
      console.info("[aurum:voice:tts]", {
        stage: "fallback_ok",
        primary_model: primaryModel,
        fallback_model: fallbackModel,
        attempts_total: attemptsTotal,
        budget_remaining_ms: remainingBudgetMs(deadlineMs),
      });
      return {
        audioBase64: audio.audioBase64,
        mimeType: audio.mimeType,
        speechText,
        latencyMs: Date.now() - started,
        provider: "gemini",
        model: fallbackModel,
        voice,
        primaryModel,
        fallbackModel,
        fallbackUsed: true,
        attemptsTotal,
      };
    } catch (fallbackErr) {
      const fb =
        fallbackErr instanceof AIProviderError
          ? fallbackErr
          : classified;
      console.warn("[aurum:voice:tts]", {
        stage: "final_failure",
        primary_model: primaryModel,
        fallback_model: fallbackModel,
        fallback_attempted: true,
        attempts_total: attemptsTotal,
        provider_error_class: providerErrorClassFor(fb),
        final_status: fb.httpStatus ?? null,
        budget_remaining_ms: remainingBudgetMs(deadlineMs),
      });
      throw fb;
    }
  }
}

function extractInlineAudio(response: unknown): {
  data: string;
  mimeType: string;
} | null {
  const r = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
          inline_data?: { data?: string; mimeType?: string };
        }>;
      };
    }>;
  };
  const part = r.candidates?.[0]?.content?.parts?.[0];
  const inline = part?.inlineData ?? part?.inline_data;
  if (!inline?.data) return null;
  return {
    data: inline.data,
    mimeType: inline.mimeType ?? "audio/L16;rate=24000",
  };
}
