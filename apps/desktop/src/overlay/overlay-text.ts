/**
 * Lightweight overlay text normalization — strip visible Markdown syntax
 * without unsafe HTML rendering.
 */
export function normalizeOverlayText(input: string): string {
  let t = input.replace(/\r\n/g, "\n").trim();
  if (!t) return "";

  // Fenced code blocks → plain content
  t = t.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, body: string) =>
    String(body ?? "").trim(),
  );

  // Headings
  t = t.replace(/^#{1,6}\s+/gm, "");

  // Images ![alt](url) → alt
  t = t.replace(/!\[([^\]]*)]\([^)]+\)/g, "$1");

  // Links [text](url) → text
  t = t.replace(/\[([^\]]+)]\([^)]+\)/g, "$1");

  // Bold then italic (order matters)
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/\*([^*\n]+)\*/g, "$1");
  t = t.replace(/_([^_\n]+)_/g, "$1");

  // Inline code
  t = t.replace(/`([^`]+)`/g, "$1");

  // Stray leftover emphasis markers
  t = t.replace(/\*\*/g, "");
  t = t.replace(/__/g, "");

  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}
