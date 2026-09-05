import { DEFAULT_CONTEXT_MESSAGE_LIMIT } from "./config";

export type ContextMessageRole = "user" | "assistant" | "system";

export interface ContextMessage {
  role: ContextMessageRole;
  content: string;
}

export interface BuildContextOptions {
  /** Prior messages from storage, oldest first */
  history: ContextMessage[];
  /** Max messages to keep (most recent) */
  limit?: number;
}

/**
 * Builds the conversation window sent to the model.
 * Designed so Phase 6 can later inject memory/summaries without rewriting callers.
 */
export function buildConversationContext(
  options: BuildContextOptions,
): ContextMessage[] {
  const limit = options.limit ?? DEFAULT_CONTEXT_MESSAGE_LIMIT;
  const cleaned = options.history
    .filter((m) => m.content.trim().length > 0)
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({
      role: m.role,
      content: m.content.trim(),
    }));

  if (cleaned.length <= limit) {
    return cleaned;
  }

  return cleaned.slice(cleaned.length - limit);
}

/** OpenAI Responses API easy input messages (legacy / optional) */
export function toResponsesInput(
  messages: ContextMessage[],
): Array<{ role: "user" | "assistant" | "system"; content: string; type: "message" }> {
  return messages.map((m) => ({
    type: "message" as const,
    role: m.role,
    content: m.content,
  }));
}

/** Gemini generateContent contents (user/model roles) */
export function toGeminiContents(
  messages: ContextMessage[],
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));
}
