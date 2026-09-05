/**
 * Pure helpers for conversation list fetch resilience (testable without React).
 */

export type ConversationListFetchResult<T> =
  | { ok: true; conversations: T[] }
  | { ok: false; error: string; conversations: T[] };

/**
 * Merge a conversation list fetch into prior state.
 * Failures MUST preserve the previous list (never treat failure as empty success).
 */
export function applyConversationListFetch<T>(options: {
  previous: T[];
  result:
    | { ok: true; conversations: T[] }
    | { ok: false; error: string };
}): ConversationListFetchResult<T> {
  if (options.result.ok) {
    return { ok: true, conversations: options.result.conversations };
  }
  return {
    ok: false,
    error: options.result.error,
    conversations: options.previous,
  };
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "APIUserAbortError";
}

/**
 * Generation abort controllers must be per-request and never shared with list fetches.
 */
export function createGenerationAbortController(): AbortController {
  return new AbortController();
}
