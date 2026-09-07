/**
 * Obsidian-compatible Markdown vault helpers (pure path/content — no I/O).
 * Device writes only inside an approved vault root via typed capability.
 */
import type { MemoryItem } from "./types";

export type VaultDocKind =
  | "profile"
  | "preferences"
  | "active_context"
  | "person"
  | "business"
  | "project"
  | "goal"
  | "decision"
  | "daily";

const UNSAFE_EXT = /\.(exe|bat|cmd|ps1|msi|dll|scr|com|js|vbs)$/i;

export function vaultRelativePath(
  kind: VaultDocKind,
  opts?: { slug?: string; date?: string },
): string {
  switch (kind) {
    case "profile":
      return "00 - Aurum/User Profile.md";
    case "preferences":
      return "00 - Aurum/Preferences.md";
    case "active_context":
      return "00 - Aurum/Active Context.md";
    case "person":
      return `People/${safeSlug(opts?.slug ?? "person")}.md`;
    case "business":
      return `Businesses/${safeSlug(opts?.slug ?? "business")}.md`;
    case "project":
      return `Projects/${safeSlug(opts?.slug ?? "project")}.md`;
    case "goal":
      return `Goals/${safeSlug(opts?.slug ?? "goal")}.md`;
    case "decision":
      return `Decisions/${safeSlug(opts?.slug ?? "decision")}.md`;
    case "daily":
      return `Daily Notes/${opts?.date ?? "unknown"}.md`;
  }
}

export function safeSlug(raw: string): string {
  return raw
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "note";
}

export function assertSafeVaultRelativePath(rel: string): void {
  const normalized = rel.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("Invalid vault path.");
  }
  if (UNSAFE_EXT.test(normalized)) {
    throw new Error("Executable extensions are not allowed in the vault.");
  }
  if (!normalized.endsWith(".md")) {
    throw new Error("Vault files must be Markdown (.md).");
  }
}

export function renderManagedSection(
  name: string,
  body: string,
): string {
  return `<!-- AURUM:START ${name} -->\n${body.trim()}\n<!-- AURUM:END ${name} -->`;
}

/** Update or insert a managed section; preserve unknown content. */
export function upsertManagedSection(
  existing: string,
  section: string,
  body: string,
): string {
  const start = `<!-- AURUM:START ${section} -->`;
  const end = `<!-- AURUM:END ${section} -->`;
  const block = renderManagedSection(section, body);
  const re = new RegExp(
    `${escapeReg(start)}[\\s\\S]*?${escapeReg(end)}`,
    "m",
  );
  if (re.test(existing)) {
    return existing.replace(re, block);
  }
  const trimmed = existing.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function preferenceVaultMarkdown(items: MemoryItem[]): string {
  const prefs = items.filter((m) => m.memory_type === "PREFERENCE");
  const lines = prefs.map((m) => `- ${m.title}: ${m.content}`);
  const body =
    lines.length > 0 ? lines.join("\n") : "- No preferences stored yet.";
  const front = [
    "---",
    "type: preferences",
    `updated: ${new Date().toISOString().slice(0, 10)}`,
    "---",
    "",
    "# Preferences",
    "",
  ].join("\n");
  return front + renderManagedSection("preferences", body) + "\n";
}

export function memoryToVaultKind(item: MemoryItem): VaultDocKind | null {
  switch (item.memory_type) {
    case "PREFERENCE":
    case "PROFILE":
      return "preferences";
    case "PERSON":
      return "person";
    case "BUSINESS":
      return "business";
    case "PROJECT":
      return "project";
    case "GOAL":
      return "goal";
    case "DECISION":
      return "decision";
    default:
      return null;
  }
}
