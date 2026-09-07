/**
 * Centralized AI model configuration.
 * Aurum Phase 2+ uses Google Gemini for text. Override with GEMINI_TEXT_MODEL.
 */
export const DEFAULT_TEXT_MODEL = "gemini-3.6-flash";

/** Gemini 3.5 Transcribe — pre-recorded STT for push-to-talk clips */
export const DEFAULT_STT_MODEL = "gemini-3.5-transcribe";

/** Gemini Flash TTS — concise spoken replies */
export const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";

/**
 * Official Gemini API sibling TTS model used only after primary transient exhaustion.
 * Same generateContent AUDIO + prebuilt voice path as the Flash preview TTS.
 * @see https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro-preview-tts
 */
export const DEFAULT_TTS_FALLBACK_MODEL = "gemini-2.5-pro-preview-tts";

export const DEFAULT_TTS_VOICE = "Kore";

/** Delays between TTS attempts (after failures). Total attempts = 3. */
export const TTS_RETRY_DELAYS_MS = [450, 1_200, 2_500] as const;

/** Retries after the first failure → 3 total attempts. */
export const MAX_TTS_RETRIES = 2;

/**
 * End-to-end TTS budget across primary retries + fallback.
 * Keeps voice turns from stalling ~40–50s on degraded paths.
 */
export const TTS_TOTAL_BUDGET_MS = 12_000;

/** Conservative default wait after HTTP 429 when Retry-After is absent. */
export const TTS_RATE_LIMIT_DEFAULT_BACKOFF_MS = 2_000;

/** Cap honored Retry-After so we never sleep the full budget on one 429. */
export const TTS_RATE_LIMIT_MAX_BACKOFF_MS = 4_000;

/** Max messages loaded from DB into a generation request (excluding system) */
export const DEFAULT_CONTEXT_MESSAGE_LIMIT = 40;

/** Max characters accepted for a single user message */
export const MAX_USER_MESSAGE_CHARS = 16_000;

/** Max conversation title length */
export const MAX_CONVERSATION_TITLE_CHARS = 80;

export function getTextModel(env: NodeJS.ProcessEnv = process.env): string {
  const override =
    env.GEMINI_TEXT_MODEL?.trim() ||
    env.OPENAI_TEXT_MODEL?.trim(); /* legacy alias */
  return override && override.length > 0 ? override : DEFAULT_TEXT_MODEL;
}

export function getSttModel(env: NodeJS.ProcessEnv = process.env): string {
  const override =
    env.VOICE_STT_MODEL?.trim() || env.GEMINI_STT_MODEL?.trim();
  return override && override.length > 0 ? override : DEFAULT_STT_MODEL;
}

export function getTtsModel(env: NodeJS.ProcessEnv = process.env): string {
  const override =
    env.VOICE_TTS_MODEL?.trim() || env.GEMINI_TTS_MODEL?.trim();
  return override && override.length > 0 ? override : DEFAULT_TTS_MODEL;
}

/** Fallback TTS model after primary transient failures (empty string disables). */
export function getTtsFallbackModel(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override =
    env.VOICE_TTS_FALLBACK_MODEL?.trim() ||
    env.GEMINI_TTS_FALLBACK_MODEL?.trim();
  if (override === "0" || override?.toLowerCase() === "off") return null;
  if (override && override.length > 0) return override;
  const primary = getTtsModel(env);
  if (primary === DEFAULT_TTS_FALLBACK_MODEL) return null;
  return DEFAULT_TTS_FALLBACK_MODEL;
}

export function getTtsVoice(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.VOICE_TTS_VOICE?.trim();
  return override && override.length > 0 ? override : DEFAULT_TTS_VOICE;
}

export function isGeminiConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

/** @deprecated Use isGeminiConfigured — kept for transitional imports */
export function isOpenAIConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isGeminiConfigured(env) || Boolean(env.OPENAI_API_KEY?.trim());
}

export function isAIConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return isGeminiConfigured(env) || Boolean(env.OPENAI_API_KEY?.trim());
}
