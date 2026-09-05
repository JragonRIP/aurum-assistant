/**
 * Desktop-local copy of Phase 4 path/app security (main process only).
 * Keep in sync with packages/tools/src/device-security.ts + path-security.ts.
 */

import fs from "node:fs";
import path from "node:path";

export function normalizePath(input: string): string {
  const replaced = input.replace(/\//g, "\\");
  return replaced.replace(/\\+/g, "\\");
}

export function isUncPath(p: string): boolean {
  return p.startsWith("\\\\") || /^[\\/]{2}/.test(p);
}

function collapseDotSegments(pathStr: string): string {
  const parts = pathStr.split("\\");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" && stack.length === 0) continue;
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (/^[a-zA-Z]:$/.test(parts[0] ?? "")) {
    return (
      `${parts[0]}\\${stack.slice(1).join("\\")}`.replace(/\\$/, "") ||
      parts[0]!
    );
  }
  if (/^[a-zA-Z]:$/.test(stack[0] ?? "")) {
    const drive = stack[0]!;
    const rest = stack.slice(1).join("\\");
    return rest ? `${drive}\\${rest}` : drive;
  }
  return stack.join("\\");
}

export function isPathInsideAllowed(
  candidatePath: string,
  allowedDirectories: string[],
): boolean {
  if (!candidatePath || allowedDirectories.length === 0) return false;
  const normalized = normalizePath(candidatePath.trim());
  if (isUncPath(normalized)) return false;
  const collapsed = collapseDotSegments(normalized);
  const lower = collapsed.toLowerCase();
  return allowedDirectories.some((allowed) => {
    const root = collapseDotSegments(normalizePath(allowed)).toLowerCase();
    const rootWithSep = root.endsWith("\\") ? root : `${root}\\`;
    return lower === root || lower.startsWith(rootWithSep);
  });
}

export const BLOCKED_EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".msi",
  ".msp",
  ".scr",
  ".cpl",
  ".reg",
  ".lnk",
  ".msc",
  ".hta",
  ".dll",
]);

export const BLOCKED_APP_NAMES = [
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "windows powershell",
  "regedit",
  "regedit.exe",
  "wscript",
  "wscript.exe",
  "cscript",
  "cscript.exe",
  "mshta",
  "mshta.exe",
  "rundll32",
  "rundll32.exe",
  "taskschd",
  "task scheduler",
  "mmc",
  "mmc.exe",
  "certutil",
  "bitsadmin",
];

const BLOCKED_PATH_FRAGMENTS = [
  "\\windows\\system32\\",
  "\\windows\\syswow64\\",
  "\\windows\\system\\",
  "\\program files\\",
  "\\program files (x86)\\",
  "\\programdata\\",
  "\\appdata\\roaming\\microsoft\\credentials\\",
  "\\appdata\\roaming\\microsoft\\protect\\",
  "\\.ssh\\",
];

export function getExtension(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx).toLowerCase();
}

export function isBlockedExecutableExtension(filePath: string): boolean {
  return BLOCKED_EXECUTABLE_EXTENSIONS.has(getExtension(filePath));
}

export function isBlockedAppName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return BLOCKED_APP_NAMES.some(
    (b) => n === b || n === b.replace(/\.exe$/, "") || n.includes(b),
  );
}

export function isBlockedSensitiveLocation(candidatePath: string): boolean {
  const lower = normalizePath(candidatePath).toLowerCase();
  if (isUncPath(lower)) return true;
  if (/^[a-z]:\\?$/.test(lower)) return true;
  return BLOCKED_PATH_FRAGMENTS.some((frag) => lower.includes(frag));
}

/**
 * Resolve junctions/symlinks where the path exists, then re-check allowlist.
 * Non-existent paths (create_folder parent checks) still use logical allowlist.
 */
function resolveCanonical(candidatePath: string): string {
  const absolute = path.resolve(candidatePath);
  try {
    return fs.realpathSync.native
      ? fs.realpathSync.native(absolute)
      : fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function assertApprovedPath(
  candidatePath: string,
  approvedRoots: string[],
): { ok: true; canonical: string } | { ok: false; code: string; message: string } {
  if (!candidatePath?.trim()) {
    return { ok: false, code: "NOT_APPROVED_PATH", message: "Empty path." };
  }
  if (isUncPath(candidatePath) || isBlockedSensitiveLocation(candidatePath)) {
    return {
      ok: false,
      code: "PATH_BLOCKED",
      message: "This location is blocked for safety.",
    };
  }
  if (!isPathInsideAllowed(candidatePath, approvedRoots)) {
    return {
      ok: false,
      code: "NOT_APPROVED_PATH",
      message: "Path is outside approved folders.",
    };
  }

  const resolved = resolveCanonical(candidatePath);
  const resolvedRoots = approvedRoots.map((r) => {
    try {
      return resolveCanonical(r);
    } catch {
      return path.resolve(r);
    }
  });

  if (isUncPath(resolved) || isBlockedSensitiveLocation(resolved)) {
    return {
      ok: false,
      code: "PATH_BLOCKED",
      message: "Resolved location is blocked for safety.",
    };
  }
  if (!isPathInsideAllowed(resolved, resolvedRoots)) {
    return {
      ok: false,
      code: "PATH_BLOCKED",
      message: "Path escapes approved folders after resolving links.",
    };
  }
  return { ok: true, canonical: normalizePath(resolved) };
}

export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function sanitizeFileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return null;
  if (/[\\/:\*\?"<>\|]/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

export function isTextReadableExtension(filePath: string): boolean {
  const ext = getExtension(filePath);
  return [
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".log",
    ".tsv",
    ".xml",
    ".yaml",
    ".yml",
    ".ini",
    ".cfg",
    ".html",
    ".css",
    ".ts",
    ".tsx",
    ".py",
    ".sql",
  ].includes(ext);
}

export function canOpenWithDefaultApp(filePath: string): boolean {
  if (isBlockedExecutableExtension(filePath)) return false;
  const ext = getExtension(filePath);
  if ([".js", ".jse", ".vbs", ".wsf"].includes(ext)) return false;
  return true;
}

export const MAX_READ_FILE_BYTES = 1_500_000;
export const MAX_SEARCH_RESULTS = 40;
export const MAX_LIST_ENTRIES = 200;
export const MAX_SEARCH_DEPTH = 6;
