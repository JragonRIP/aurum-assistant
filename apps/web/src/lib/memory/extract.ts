/**
 * Conservative post-turn / explicit memory extraction (deterministic v1).
 * No model call required for high-confidence explicit patterns.
 */
import type { MemoryCandidate } from "./types";
import { normalizeCanonicalKey, parseResponseDetailValue } from "./types";

const SECRET_HINT =
  /\b(api[\s_-]?key|password|secret|token|private[\s_-]?key|credit card)\b/i;

export function extractExplicitMemoryCandidates(userMessage: string): MemoryCandidate[] {
  const text = userMessage.trim();
  if (!text) return [];
  if (SECRET_HINT.test(text)) {
    return [
      {
        action: "IGNORE",
        type: "FACT",
        importance: "USEFUL",
        title: "Rejected secret",
        content: "Secret material must not be stored.",
        confidence: 1,
        reason: "secret",
      },
    ];
  }

  const out: MemoryCandidate[] = [];

  // Forget
  if (/\b(forget that|don't remember|do not remember|forget what)\b/i.test(text)) {
    // handled by tool path; extraction ignores
    return [];
  }

  // Response detail preference
  if (
    /\b(from now on|prefer|keep|always)\b/i.test(text) &&
    /\b(concise|short|brief|detailed|in depth|balanced)\b/i.test(text) &&
    /\b(answers?|responses?|replies|detail)\b/i.test(text)
  ) {
    const value = parseResponseDetailValue(text) ?? "concise";
    out.push({
      action: "UPDATE",
      type: "PREFERENCE",
      importance: "IMPORTANT",
      canonicalKey: "preference:response_detail",
      title: "Response detail preference",
      content: `User prefers ${value} answers by default.`,
      confidence: 0.98,
    });
  }

  // Explicit remember
  const rememberMatch = text.match(
    /\b(?:remember(?:\s+that)?|keep this in mind|note that)\b[:\s]+(.+)/i,
  );
  if (rememberMatch?.[1]) {
    const content = rememberMatch[1].trim().slice(0, 400);
    out.push({
      action: "CREATE",
      type: inferType(content),
      importance: "USEFUL",
      canonicalKey: guessCanonicalKey(content),
      title: titleFrom(content),
      content,
      confidence: 0.97,
    });
  }

  // Goal
  const goalMatch = text.match(/\b(?:my goal is|goal is to|i want to reach)\b\s+(.+)/i);
  if (goalMatch?.[1]) {
    const content = goalMatch[1].trim().slice(0, 400);
    out.push({
      action: "UPDATE",
      type: "GOAL",
      importance: "IMPORTANT",
      canonicalKey: normalizeCanonicalKey(`goal:${content.slice(0, 40)}`),
      title: "Goal",
      content,
      confidence: 0.92,
    });
  }

  // Correction of goal numbers
  const makeThat = text.match(/\bactually\s+(?:make that|it'?s)\s+(\d+)/i);
  if (makeThat?.[1] && /\bclient/i.test(text)) {
    out.push({
      action: "SUPERSEDE",
      type: "GOAL",
      importance: "IMPORTANT",
      canonicalKey: "goal:clients",
      title: "Client goal",
      content: `Target is ${makeThat[1]} clients.`,
      confidence: 0.95,
    });
  }

  return out;
}

/**
 * Weak automatic extraction — only strong preference/goal patterns.
 * Most chat is IGNORE.
 */
export function extractInferredMemoryCandidates(
  userMessage: string,
  _assistantMessage: string,
): MemoryCandidate[] {
  const text = userMessage.trim();
  if (!text || text.length < 12) return [];
  if (/^(what|who|when|where|how|why|is|are|can|do|does)\b/i.test(text)) {
    // questions usually not durable memory
    if (!/\b(prefer|always|from now on|my goal)\b/i.test(text)) return [];
  }
  if (/\b(weather|price of|how much is|search|look up)\b/i.test(text)) return [];
  return extractExplicitMemoryCandidates(text).filter(
    (c) => c.action !== "IGNORE" && c.confidence >= 0.9,
  );
}

function inferType(content: string): MemoryCandidate["type"] {
  const t = content.toLowerCase();
  if (/\bprefer|always|from now on\b/.test(t)) return "PREFERENCE";
  if (/\bgoal|want to reach\b/.test(t)) return "GOAL";
  if (/\bproject|working on\b/.test(t)) return "PROJECT";
  if (/\bbusiness|client|company\b/.test(t)) return "BUSINESS";
  return "FACT";
}

function titleFrom(content: string): string {
  const t = content.trim();
  if (t.length <= 60) return t;
  return `${t.slice(0, 57)}...`;
}

function guessCanonicalKey(content: string): string | undefined {
  const t = content.toLowerCase();
  if (/\bconcise|detailed|balanced\b/.test(t) && /\banswer|response\b/.test(t)) {
    return "preference:response_detail";
  }
  if (/\bclient/.test(t) && /\b\d+\b/.test(t)) return "goal:clients";
  return undefined;
}
