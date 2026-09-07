/**
 * Typed vault write — only inside an approved vault root.
 * Gemini never supplies arbitrary paths; relative docs are resolved here.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { assertApprovedPath } from "./security";
import type { ApprovedRoot, DeviceToolResult } from "./windows-tools";

const UNSAFE_EXT = /\.(exe|bat|cmd|ps1|msi|dll|scr|com|js|vbs)$/i;

const DOC_PATHS: Record<string, (slug?: string, date?: string) => string> = {
  profile: () => "00 - Aurum/User Profile.md",
  preferences: () => "00 - Aurum/Preferences.md",
  active_context: () => "00 - Aurum/Active Context.md",
  person: (slug) => `People/${safeSlug(slug ?? "person")}.md`,
  business: (slug) => `Businesses/${safeSlug(slug ?? "business")}.md`,
  project: (slug) => `Projects/${safeSlug(slug ?? "project")}.md`,
  goal: (slug) => `Goals/${safeSlug(slug ?? "goal")}.md`,
  decision: (slug) => `Decisions/${safeSlug(slug ?? "decision")}.md`,
  daily: (_slug, date) => `Daily Notes/${date ?? "unknown"}.md`,
};

export function safeSlug(raw: string): string {
  return (
    raw
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "note"
  );
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

export function resolveVaultRelativePath(
  kind: string,
  opts?: { slug?: string; date?: string },
): string {
  const fn = DOC_PATHS[kind];
  if (!fn) throw new Error(`Unknown vault document kind: ${kind}`);
  return fn(opts?.slug, opts?.date);
}

export function upsertManagedSection(
  existing: string,
  section: string,
  body: string,
): string {
  const start = `<!-- AURUM:START ${section} -->`;
  const end = `<!-- AURUM:END ${section} -->`;
  const block = `${start}\n${body.trim()}\n${end}`;
  const re = new RegExp(
    `${escapeReg(start)}[\\s\\S]*?${escapeReg(end)}`,
    "m",
  );
  if (re.test(existing)) return existing.replace(re, block);
  const trimmed = existing.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rootsPaths(roots: ApprovedRoot[]): string[] {
  return roots.map((r) => r.canonical_path);
}

/**
 * Write or merge a managed Markdown section under the approved vault root.
 * Payload:
 * - vaultRoot: absolute approved root path
 * - kind: profile|preferences|project|...
 * - slug / date: optional
 * - section: managed section name
 * - body: markdown body for the section
 * - frontmatter: optional minimal YAML (no secrets)
 */
export async function vaultWriteManagedFile(
  payload: Record<string, unknown>,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const vaultRoot = String(payload.vaultRoot ?? "").trim();
  const kind = String(payload.kind ?? "").trim();
  const section = String(payload.section ?? "content").trim() || "content";
  const body = typeof payload.body === "string" ? payload.body : "";
  const slug =
    typeof payload.slug === "string" ? payload.slug : undefined;
  const date =
    typeof payload.date === "string" ? payload.date : undefined;
  const frontmatter =
    typeof payload.frontmatter === "string" ? payload.frontmatter : null;

  if (!vaultRoot) {
    return {
      success: false,
      error: {
        code: "NOT_APPROVED_PATH",
        message: "Vault root is not configured.",
      },
    };
  }
  if (roots.length === 0) {
    return {
      success: false,
      error: {
        code: "NOT_APPROVED_PATH",
        message: "No approved folders. Approve the vault folder first.",
      },
    };
  }

  let rel: string;
  try {
    rel = resolveVaultRelativePath(kind, { slug, date });
    assertSafeVaultRelativePath(rel);
  } catch (err) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: err instanceof Error ? err.message : "Invalid vault document.",
      },
    };
  }

  const rootGate = assertApprovedPath(vaultRoot, rootsPaths(roots));
  if (!rootGate.ok) {
    return {
      success: false,
      error: { code: rootGate.code, message: rootGate.message },
    };
  }

  const full = path.join(rootGate.canonical, ...rel.split("/"));
  const fileGate = assertApprovedPath(full, rootsPaths(roots));
  if (!fileGate.ok) {
    return {
      success: false,
      error: { code: fileGate.code, message: fileGate.message },
    };
  }

  await fs.mkdir(path.dirname(fileGate.canonical), { recursive: true });

  let existing = "";
  if (fsSync.existsSync(fileGate.canonical)) {
    existing = await fs.readFile(fileGate.canonical, "utf8");
  } else if (frontmatter) {
    existing = `${frontmatter.trim()}\n\n`;
  }

  const next = upsertManagedSection(existing, section, body);
  await fs.writeFile(fileGate.canonical, next, "utf8");

  return {
    success: true,
    data: {
      path: fileGate.canonical,
      relativePath: rel,
      activityLabel: "Vault updated",
      message: "Vault note updated.",
    },
  };
}
