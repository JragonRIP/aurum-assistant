/**
 * Build a concise string suitable for TTS from a final assistant text reply.
 * No second model call — deterministic trimming only.
 */
export function buildSpeechResponse(
  text: string,
  opts?: { maxChars?: number },
): string {
  const max = opts?.maxChars ?? 320;
  let t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return "";

  // Drop markdown noise / URLs for speech
  t = t
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (t.length <= max) return t;

  // Prefer first sentence(s) within budget
  const parts = t.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const p of parts) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > max) break;
    out = next;
    if (out.length >= Math.min(120, max)) break;
  }
  if (out) return out;
  return `${t.slice(0, max - 1).trim()}…`;
}
