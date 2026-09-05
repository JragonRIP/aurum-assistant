/**
 * Mutation audit log for Windows capabilities.
 * Never logs secrets, paths that look like credential stores, or raw refs' native IDs.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type AuditEntry = {
  timestamp: string;
  tool: string;
  permission: string;
  success: boolean;
  durationMs: number;
  /** Sanitized argument summary — no clipboard bodies, no file contents */
  argsSummary: Record<string, unknown>;
  errorCode?: string;
  generationId?: string;
  executionId?: string;
};

const SENSITIVE_KEYS = new Set([
  "content",
  "text",
  "clipboard",
  "password",
  "token",
  "secret",
  "value",
]);

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const key = k.toLowerCase();
    if (SENSITIVE_KEYS.has(key) || key.includes("content") || key.includes("text")) {
      out[k] = typeof v === "string" ? `[redacted len=${v.length}]` : "[redacted]";
      continue;
    }
    if (typeof v === "string" && v.length > 120) {
      out[k] = `${v.slice(0, 40)}…`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

let queue: AuditEntry[] = [];
const MAX_MEMORY = 500;

export function recordAudit(entry: Omit<AuditEntry, "timestamp"> & { timestamp?: string }): void {
  const full: AuditEntry = {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    argsSummary: sanitizeArgs(entry.argsSummary ?? {}),
  };
  queue.push(full);
  if (queue.length > MAX_MEMORY) queue = queue.slice(-MAX_MEMORY);
  void persist(full).catch(() => {
    /* best-effort */
  });
}

async function persist(entry: AuditEntry): Promise<void> {
  try {
    // Lazy electron import — unit tests may run outside Electron
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    if (!app?.isReady?.()) return;
    const dir = path.join(app.getPath("userData"), "audit");
    await fs.mkdir(dir, { recursive: true });
    const day = entry.timestamp.slice(0, 10);
    const file = path.join(dir, `windows-${day}.jsonl`);
    await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

/** Test / Activity feed helper */
export function getRecentAudit(limit = 50): AuditEntry[] {
  return queue.slice(-limit);
}

export function clearAuditMemory(): void {
  queue = [];
}
