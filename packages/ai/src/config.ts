/**
 * Centralized AI model configuration.
 * Aurum Phase 2+ uses Google Gemini for text. Override with GEMINI_TEXT_MODEL.
 */
export const DEFAULT_TEXT_MODEL = "gemini-3.6-flash";

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
