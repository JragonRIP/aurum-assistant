/**
 * Phase 4 path + file-type security for Windows device tools.
 * Extends isPathInsideAllowed with blocked locations and executable policy.
 */

export {
  isPathInsideAllowed,
  isUncPath,
  normalizePath,
} from "./path-security";
import { isPathInsideAllowed, isUncPath, normalizePath } from "./path-security";

/** Dangerous extensions — never open/copy/move/rename into these */
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

/** Apps that must never launch via open_application */
export const BLOCKED_APP_NAMES = [
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "windows powershell",
  "windows terminal",
  "wt",
  "wt.exe",
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
  "certutil.exe",
  "bitsadmin",
  "bitsadmin.exe",
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
  "\\appdata\\local\\google\\chrome\\user data\\default\\login data",
  "\\appdata\\roaming\\mozilla\\firefox\\profiles\\",
  "\\.ssh\\",
  "\\ntuser.dat",
  "\\sam",
  "\\security\\",
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

export function isDevicePath(path: string): boolean {
  const n = normalizePath(path).toLowerCase();
  return (
    n.startsWith("\\\\.\\") ||
    n.startsWith("\\\\?\\") ||
    /^[\\/]{2}\./.test(path)
  );
}

export function isBlockedSensitiveLocation(candidatePath: string): boolean {
  const lower = normalizePath(candidatePath).toLowerCase();
  if (isUncPath(lower) || isDevicePath(lower)) return true;
  // Drive root alone is never a safe working path for tools
  if (/^[a-z]:\\?$/.test(lower)) return true;
  return BLOCKED_PATH_FRAGMENTS.some((frag) => lower.includes(frag));
}

export type PathAccessResult =
  | { ok: true; canonical: string }
  | { ok: false; code: string; message: string };

/**
 * Full Windows path gate for device file tools.
 */
export function assertApprovedPath(
  candidatePath: string,
  approvedRoots: string[],
): PathAccessResult {
  if (!candidatePath?.trim()) {
    return { ok: false, code: "NOT_APPROVED_PATH", message: "Empty path." };
  }
  if (isUncPath(candidatePath) || isDevicePath(candidatePath)) {
    return {
      ok: false,
      code: "PATH_BLOCKED",
      message: "Network/device paths are not allowed.",
    };
  }
  if (isBlockedSensitiveLocation(candidatePath)) {
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
  return { ok: true, canonical: normalizePath(candidatePath) };
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
    ".conf",
    ".html",
    ".css",
    ".ts",
    ".tsx",
    ".js", // read may be allowed; open/execute blocked separately for scripts in other policies
    ".jsx",
    ".py",
    ".rs",
    ".go",
    ".sql",
  ].includes(ext);
}

/** open_file: documents/media ok; scripts/executables blocked */
export function canOpenWithDefaultApp(filePath: string): boolean {
  if (isBlockedExecutableExtension(filePath)) return false;
  const ext = getExtension(filePath);
  // .js as open-with-default is risky on Windows associations — block
  if ([".js", ".jse", ".vbs", ".wsf"].includes(ext)) return false;
  return true;
}

export function sanitizeFileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return null;
  if (/[\\/:\*\?"<>\|]/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const MAX_READ_FILE_BYTES = 1_500_000;
export const MAX_SEARCH_RESULTS = 40;
export const MAX_LIST_ENTRIES = 200;
export const MAX_SEARCH_DEPTH = 6;
