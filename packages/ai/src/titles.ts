import { MAX_CONVERSATION_TITLE_CHARS } from "./config";

const DEFAULT_TITLE = "New conversation";

/**
 * Deterministic, low-cost title from the user's first message.
 * Avoids an extra model call in Phase 2.
 */
export function deriveConversationTitle(
  firstUserMessage: string,
  maxLength = MAX_CONVERSATION_TITLE_CHARS,
): string {
  const cleaned = firstUserMessage
    .replace(/\s+/g, " ")
    .replace(/^hey\s+aurum[,!.]?\s*/i, "")
    .replace(/^aurum[,!.]?\s*/i, "")
    .trim();

  if (!cleaned) {
    return DEFAULT_TITLE;
  }

  // Take first sentence-ish chunk
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  let title = sentence.trim();

  if (title.length > maxLength) {
    title = `${title.slice(0, maxLength - 1).trimEnd()}…`;
  }

  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Strip trailing punctuation for cleaner sidebar labels
  title = title.replace(/[.?!]+$/, "");

  return title || DEFAULT_TITLE;
}

export function isDefaultConversationTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  return title.trim().toLowerCase() === DEFAULT_TITLE.toLowerCase();
}

export { DEFAULT_TITLE as DEFAULT_CONVERSATION_TITLE };
