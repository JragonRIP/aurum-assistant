/**
 * Process listing / protected termination.
 * Uses fixed tasklist/taskkill argv only — never model-supplied command strings.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isBlockedAppName } from "./security";
import { rememberProcess, resolveProcess } from "./trusted-refs";
import type { DeviceToolResult } from "./windows-tools";

const execFileAsync = promisify(execFile);

/** Critical / security processes — never terminate via Aurum */
const PROTECTED_PROCESS_NAMES = new Set(
  [
    "system",
    "smss",
    "csrss",
    "wininit",
    "services",
    "lsass",
    "lsaiso",
    "svchost",
    "winlogon",
    "fontdrvhost",
    "dwm",
    "explorer",
    "sihost",
    "taskhostw",
    "runtimebroker",
    "securityhealthservice",
    "msmpeng",
    "nissrv",
    "securityhealthsystray",
    "smartscreen",
    "consent",
    "audiodg",
    "conhost",
    "registry",
    "memory compression",
    "idle",
    "aurum",
    "electron",
  ].map((s) => s.toLowerCase()),
);

export function isProtectedProcessName(name: string): boolean {
  const base = name.replace(/\.exe$/i, "").trim().toLowerCase();
  if (!base) return true;
  if (PROTECTED_PROCESS_NAMES.has(base)) return true;
  if (base.includes("defender") || base.includes("antivirus")) return true;
  if (base.startsWith("aurum")) return true;
  return false;
}

export async function listProcesses(limit = 40): Promise<DeviceToolResult> {
  if (process.platform !== "win32") {
    return {
      success: false,
      error: { code: "UNSUPPORTED", message: "Windows only." },
    };
  }
  try {
    // Fixed argv — CONTROLLED OS API
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/fo", "csv", "/nh"],
      { timeout: 10_000, windowsHide: true },
    );
    const rows: Array<{
      processReference: string;
      name: string;
      pid: number;
      memoryMb: number | null;
      protected: boolean;
    }> = [];

    for (const line of stdout.split(/\r?\n/)) {
      if (rows.length >= limit) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      // "name.exe","PID","Session Name","Session#","Mem Usage"
      const cols = trimmed.match(/"(.*?)"/g)?.map((s) => s.slice(1, -1));
      if (!cols || cols.length < 5) continue;
      const name = (cols[0] ?? "").replace(/\.exe$/i, "");
      const pid = Number(cols[1]);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (isBlockedAppName(name)) continue;
      const memRaw = (cols[4] ?? "").replace(/[^\d]/g, "");
      const memKb = Number(memRaw);
      const memoryMb = Number.isFinite(memKb)
        ? Math.round((memKb / 1024) * 10) / 10
        : null;
      const protectedProc = isProtectedProcessName(name);
      const processReference = rememberProcess({
        pid,
        name,
        memoryMb,
      });
      rows.push({
        processReference,
        name,
        pid,
        memoryMb,
        protected: protectedProc,
      });
    }

    // Sort by memory desc for "what's using the most memory"
    rows.sort((a, b) => (b.memoryMb ?? 0) - (a.memoryMb ?? 0));

    return {
      success: true,
      data: {
        processes: rows,
        activityLabel: "Listed processes",
      },
      message: `Found ${rows.length} processes.`,
    };
  } catch {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not list processes." },
    };
  }
}

export async function terminateProcess(
  processReference: unknown,
): Promise<DeviceToolResult> {
  const proc = resolveProcess(processReference);
  if (!proc) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired process reference. List processes again.",
      },
    };
  }
  if (isProtectedProcessName(proc.name)) {
    return {
      success: false,
      error: {
        code: "PROCESS_PROTECTED",
        message: `“${proc.name}” is protected and cannot be terminated through Aurum.`,
      },
    };
  }
  const pid = Math.trunc(proc.pid);
  if (!Number.isFinite(pid) || pid <= 4) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid process id." },
    };
  }
  try {
    // Fixed argv with numeric PID only — CONTROLLED OS API
    await execFileAsync("taskkill", ["/PID", String(pid), "/T"], {
      timeout: 8_000,
      windowsHide: true,
    });
    return {
      success: true,
      data: {
        name: proc.name,
        pid,
        activityLabel: `Terminated · ${proc.name}`,
      },
      message: `Terminated ${proc.name}.`,
    };
  } catch {
    return {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: `Could not terminate ${proc.name}.`,
      },
    };
  }
}
