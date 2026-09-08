/**
 * Deterministic spoken-only address insertion.
 * Display / stored / tool text must never pass through here.
 *
 * Sole owner of vocative insertion — the model must not also add "sir".
 */

export type PreferredAddressMode = "none" | "sir" | "first_name" | "custom";

export type PreferredAddress = {
  mode: PreferredAddressMode;
  /** First name or custom token when mode is first_name / custom. */
  value?: string;
};

export const DEFAULT_PREFERRED_ADDRESS: PreferredAddress = { mode: "sir" };

const SKIP_WHOLE_REPLY =
  /^(okay|ok|sure|sure thing|yep|yeah|yup|nah|nope)[.!]?$/i;

export function resolveAddressToken(
  address: PreferredAddress | PreferredAddressMode | null | undefined,
): string | null {
  if (!address) return "sir";
  if (typeof address === "string") {
    if (address === "none") return null;
    if (address === "sir") return "sir";
    return null;
  }
  if (address.mode === "none") return null;
  if (address.mode === "sir") return "sir";
  const value = address.value?.trim();
  if (!value) return null;
  if (/\s/.test(value) || value.length > 24) return null;
  return value;
}

export function spokenAlreadyHasAddress(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

/**
 * Append a single vocative to the last sentence when it sounds natural.
 * Never inserts more than once. Never prepends "Sir,".
 */
export function applySpokenAddress(
  text: string,
  address: PreferredAddress | PreferredAddressMode = DEFAULT_PREFERRED_ADDRESS,
): string {
  const token = resolveAddressToken(address);
  if (!token) return text;
  const t = text.trim();
  if (!t) return text;
  if (spokenAlreadyHasAddress(t, token)) return t;
  if (SKIP_WHOLE_REPLY.test(t)) return t;

  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 5) return t;

  const last = sentences[sentences.length - 1] ?? t;
  if (last.length > 220) return t;

  const nextLast = appendAddressToSentence(last, token);
  if (nextLast === last) return t;
  if (sentences.length <= 1) return nextLast;
  return `${sentences.slice(0, -1).join(" ")} ${nextLast}`.replace(/\s+/g, " ").trim();
}

function appendAddressToSentence(sentence: string, token: string): string {
  const s = sentence.trim();
  if (!s) return s;
  const match = s.match(/^(.*?)([.!?])$/);
  if (match) {
    const body = match[1]!.trimEnd();
    const punct = match[2]!;
    if (spokenAlreadyHasAddress(body, token)) return s;
    return `${body}, ${token}${punct}`;
  }
  return `${s}, ${token}.`;
}
