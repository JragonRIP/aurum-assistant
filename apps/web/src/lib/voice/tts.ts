/**
 * Text-to-speech via Gemini TTS (server-side only).
 * Server owns provider retries within a hard latency budget.
 * 429 / RESOURCE_EXHAUSTED uses QuotaFailure + RetryInfo (safe fields only)
 * and a per-model circuit breaker so Aurum does not hammer daily quotas.
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
  TTS_RETRY_DELAYS_MS,
  TTS_TOTAL_BUDGET_MS,
} from "@aurum/ai";
import { getGeminiClient } from "@/lib/ai/gemini-client";
import {
  getTtsCircuit,
  noteTtsCircuitHit,
  openTtsCircuit,
} from "@/lib/voice/tts-circuit";
import {
  extractSafeTtsQuotaInfo,
  safeQuotaLogFields,
  type SafeTtsQuotaInfo,
} from "@/lib/voice/tts-quota";

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
  circuitHit?: boolean;
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

export type TtsFailureExtras = {
  quotaInfo?: SafeTtsQuotaInfo | null;
  circuitOpen?: boolean;
};

export function getTtsFailureExtras(err: unknown): TtsFailureExtras {
  const obj = err && typeof err === "object" ? (err as TtsFailureExtras) : null;
  return {
    quotaInfo: obj?.quotaInfo ?? null,
    circuitOpen: Boolean(obj?.circuitOpen),
  };
}

function withTtsFailureExtras(
  err: AIProviderError,
  extras: TtsFailureExtras,
): AIProviderError {
  const e = err as AIProviderError & TtsFailureExtras;
  if (extras.quotaInfo) e.quotaInfo = extras.quotaInfo;
  if (extras.circuitOpen) e.circuitOpen = true;
  return e;
}

export function httpStatusForTtsError(err: AIProviderError): number {
  if (err.kind === "auth") return err.httpStatus === 403 ? 403 : 401;
  if (err.kind === "invalid_request") return 400;
  if (err.kind === "cancelled") {
    return err.code === "budget_exhausted" ? 504 : 499;
  }
  if (err.code === "circuit_open" || err.httpStatus === 429) return 429;
  if (err.httpStatus === 503) return 503;
  if (err.httpStatus === 504) return 504;
  return 502;
}

export function providerErrorClassFor(
  err: AIProviderError,
): TtsProviderErrorClass {
  if (err.code === "no_audio") return "no_audio";
  if (err.code === "budget_exhausted") return "budget_exhausted";
  if (err.code === "circuit_open" || err.httpStatus === 429) return "rate_limited";
  return err.kind;
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

function circuitOpenError(
  model: string,
  quotaInfo: SafeTtsQuotaInfo | null,
): AIProviderError {
  return withTtsFailureExtras(
    new AIProviderError({
      message: "Voice synthesis temporarily rate-limited.",
      kind: "transient",
      provider: "gemini",
      retryable: false,
      httpStatus: 429,
      code: "circuit_open",
    }),
    { quotaInfo, circuitOpen: true },
  );
}

/**
 * Decide whether a 429 should be retried inside this voice turn.
 * Daily / multi-hour RetryInfo must not burn more quota or stall the turn.
 */
export function shouldRetryRateLimit(opts: {
  quotaInfo: SafeTtsQuotaInfo;
  remainingBudgetMs: number;
  alreadyRetried429: boolean;
}): { retry: boolean; delayMs: number | null; reason: string } {
  if (opts.alreadyRetried429) {
    return { retry: false, delayMs: null, reason: "already_retried_429" };
  }
  if (opts.quotaInfo.isDailyQuota) {
    return { retry: false, delayMs: null, reason: "daily_quota" };
  }
  const delay = opts.quotaInfo.retryDelayMs;
  if (delay == null) {
    // No RetryInfo: do not speculative-retry RESOURCE_EXHAUSTED (often RPD).
    return { retry: false, delayMs: null, reason: "no_retry_info" };
  }
  if (delay + 500 >= opts.remainingBudgetMs) {
    return { retry: false, delayMs: delay, reason: "delay_exceeds_budget" };
  }
  // Short RPM-style RetryInfo that fits the voice budget: one bounded retry.
  return { retry: true, delayMs: delay, reason: "retry_info_within_budget" };
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
  const circuit = getTtsCircuit(opts.model);
  if (circuit.open) {
    noteTtsCircuitHit(opts.model);
    throw circuitOpenError(opts.model, {
      httpStatus: 429,
      statusText: "RESOURCE_EXHAUSTED",
      quotaMetric: circuit.quotaMetric,
      quotaId: circuit.quotaId,
      model: opts.model,
      location: null,
      limit: null,
      retryDelayMs: circuit.remainingMs,
      isDailyQuota: circuit.remainingMs >= 60 * 60 * 1000,
      isFreeTierMetric: false,
      violations: [],
    });
  }

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
      if (err instanceof AIProviderError && err.code === "circuit_open") {
        throw err;
      }

      const classified =
        err instanceof AIProviderError
          ? err
          : classifyProviderError(err, "gemini");
      lastError = classified;
      const is429 =
        classified.httpStatus === 429 ||
        classified.code === "RESOURCE_EXHAUSTED" ||
        /RESOURCE_EXHAUSTED/i.test(classified.message);

      if (is429) {
        const quotaInfo = extractSafeTtsQuotaInfo(err);
        openTtsCircuit({
          model: opts.model,
          retryDelayMs: quotaInfo.retryDelayMs,
          quotaMetric: quotaInfo.quotaMetric,
          quotaId: quotaInfo.quotaId,
        });
        const decision = shouldRetryRateLimit({
          quotaInfo,
          remainingBudgetMs: remainingBudgetMs(opts.deadlineMs),
          alreadyRetried429: rateLimitRetries >= 1,
        });
        console.warn("[aurum:voice:tts]", {
          stage: "attempt",
          purpose: opts.label,
          attempt,
          model: opts.model,
          status: 429,
          latency_ms: Date.now() - attemptStarted,
          provider_error_class: "rate_limited",
          retrying: decision.retry,
          retry_reason: decision.reason,
          delay_ms: decision.delayMs,
          budget_remaining_ms: remainingBudgetMs(opts.deadlineMs),
          ...safeQuotaLogFields(quotaInfo),
        });
        const enriched = withTtsFailureExtras(
          new AIProviderError({
            message: classified.message,
            kind: "transient",
            provider: "gemini",
            retryable: false,
            httpStatus: 429,
            code: classified.code ?? "RESOURCE_EXHAUSTED",
            cause: err,
          }),
          { quotaInfo },
        );
        if (!decision.retry || decision.delayMs == null) {
          throw enriched;
        }
        rateLimitRetries += 1;
        await sleepWithSignal(decision.delayMs, opts.signal);
        continue;
      }

      let willRetry =
        classified.retryable &&
        attempt < maxAttempts &&
        !opts.signal?.aborted &&
        classified.kind !== "cancelled";

      const delayMs = willRetry
        ? (TTS_RETRY_DELAYS_MS[attempt - 1] ??
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
  let circuitHit = false;

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

  const primaryCircuit = getTtsCircuit(primaryModel);
  if (primaryCircuit.open) {
    circuitHit = true;
    noteTtsCircuitHit(primaryModel);
  }

  try {
    if (primaryCircuit.open) {
      throw circuitOpenError(primaryModel, {
        httpStatus: 429,
        statusText: "RESOURCE_EXHAUSTED",
        quotaMetric: primaryCircuit.quotaMetric,
        quotaId: primaryCircuit.quotaId,
        model: primaryModel,
        location: null,
        limit: null,
        retryDelayMs: primaryCircuit.remainingMs,
        isDailyQuota: primaryCircuit.remainingMs >= 60 * 60 * 1000,
        isFreeTierMetric: false,
        violations: [],
      });
    }
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
      circuitHit,
    };
  } catch (primaryErr) {
    const classified =
      primaryErr instanceof AIProviderError
        ? primaryErr
        : classifyProviderError(primaryErr, "gemini");
    const extras = getTtsFailureExtras(primaryErr);
    const primaryWasRateLimited =
      classified.httpStatus === 429 ||
      classified.code === "circuit_open" ||
      classified.code === "RESOURCE_EXHAUSTED";

    // Pro TTS has a separate per-model daily quota — fall back on Flash RPD exhaustion.
    const canFallback =
      Boolean(fallbackModel) &&
      classified.kind !== "cancelled" &&
      classified.kind !== "auth" &&
      classified.kind !== "invalid_request" &&
      (classified.retryable || primaryWasRateLimited) &&
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
        circuit_hit: circuitHit || extras.circuitOpen,
        ...safeQuotaLogFields(
          extras.quotaInfo ?? {
            httpStatus: null,
            statusText: null,
            quotaMetric: null,
            quotaId: null,
            model: null,
            location: null,
            limit: null,
            retryDelayMs: null,
            isDailyQuota: false,
            isFreeTierMetric: false,
            violations: [],
          },
        ),
      });
      throw classified;
    }

    console.info("[aurum:voice:tts]", {
      stage: "fallback_start",
      primary_model: primaryModel,
      fallback_model: fallbackModel,
      reason: primaryWasRateLimited
        ? "primary_rate_limited"
        : "primary_transient",
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
        circuitHit: circuitHit || extras.circuitOpen === true,
      };
    } catch (fallbackErr) {
      const fb =
        fallbackErr instanceof AIProviderError ? fallbackErr : classified;
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
