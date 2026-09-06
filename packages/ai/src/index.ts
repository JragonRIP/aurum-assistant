export {
  DEFAULT_TEXT_MODEL,
  DEFAULT_CONTEXT_MESSAGE_LIMIT,
  MAX_USER_MESSAGE_CHARS,
  MAX_CONVERSATION_TITLE_CHARS,
  getTextModel,
  isGeminiConfigured,
  isAIConfigured,
  isOpenAIConfigured,
} from "./config";
export {
  AURUM_SYSTEM_INSTRUCTIONS,
  AURUM_SPOKEN_STYLE,
  DEFAULT_RESPONSE_DETAIL_PREFERENCE,
  buildSystemPrompt,
} from "./personality";
export type { ResponseDetailPreference } from "./personality";
export {
  buildConversationContext,
  toResponsesInput,
  toGeminiContents,
} from "./context";
export type {
  ContextMessage,
  ContextMessageRole,
  BuildContextOptions,
} from "./context";
export {
  deriveConversationTitle,
  isDefaultConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "./titles";
export {
  AIProviderError,
  AI_PROVIDER_UNAVAILABLE_MESSAGE,
  classifyProviderError,
  logProviderAttempt,
} from "./provider-errors";
export type {
  AIProviderName,
  ProviderErrorKind,
  ProviderAttemptLog,
} from "./provider-errors";
export {
  withProviderRetry,
  sleepWithSignal,
  CHAT_RETRY_DELAYS_MS,
  MAX_CHAT_RETRIES,
} from "./retry";
