import fs from "node:fs/promises";
import fsSync from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { shell } from "electron";
import {
  assertApprovedPath,
  canOpenWithDefaultApp,
  getExtension,
  isBlockedAppName,
  isBlockedExecutableExtension,
  isSafeUrl,
  isTextReadableExtension,
  MAX_LIST_ENTRIES,
  MAX_READ_FILE_BYTES,
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_RESULTS,
  normalizePath,
  sanitizeFileName,
} from "./security";
import { capabilityBrokerExecute } from "./windows-capability-broker";
import { windowsSystemExecute } from "./windows-system";

const execFileAsync = promisify(execFile);

export type DeviceToolResult = {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
  error?: { code: string; message: string };
};

export type ApprovedRoot = { id: string; label: string; canonical_path: string };

const recentExecutions = new Map<string, DeviceToolResult>();

export function getReplayResult(executionId: string): DeviceToolResult | null {
  return recentExecutions.get(executionId) ?? null;
}

export function rememberResult(
  executionId: string,
  result: DeviceToolResult,
): void {
  recentExecutions.set(executionId, result);
  if (recentExecutions.size > 200) {
    const first = recentExecutions.keys().next().value;
    if (first) recentExecutions.delete(first);
  }
}

function rootsPaths(roots: ApprovedRoot[]): string[] {
  return roots.map((r) => r.canonical_path);
}

export async function executeDesktopTool(opts: {
  tool: string;
  payload: Record<string, unknown>;
  approvedRoots: ApprovedRoot[];
  executionId: string;
}): Promise<DeviceToolResult> {
  const replay = getReplayResult(opts.executionId);
  if (replay) return replay;

  let result: DeviceToolResult;
  try {
    result = await runTool(opts.tool, opts.payload, opts.approvedRoots);
  } catch (err) {
    result = {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: "Desktop tool failed.",
      },
    };
    console.error("[aurum:desktop-tool]", opts.tool, err);
  }
  rememberResult(opts.executionId, result);
  return result;
}

async function runTool(
  tool: string,
  payload: Record<string, unknown>,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  switch (tool) {
    case "get_running_apps":
      return getRunningApps();
    case "open_application":
      return openApplication(String(payload.app ?? ""));
    case "open_url":
      return openUrl(String(payload.url ?? ""));
    case "list_directory":
      return listDirectory(String(payload.path ?? ""), roots, Number(payload.limit ?? 100));
    case "search_files":
      return searchFiles({
        query: String(payload.query ?? ""),
        extension: payload.extension ? String(payload.extension) : undefined,
        roots,
        limit: Number(payload.limit ?? MAX_SEARCH_RESULTS),
      });
    case "read_file":
      return readFile(String(payload.path ?? ""), roots);
    case "open_file":
      return openFile(String(payload.path ?? ""), roots);
    case "open_folder":
      return openFolder(String(payload.path ?? ""), roots);
    case "create_folder":
      return createFolder(
        String(payload.parent_path ?? ""),
        String(payload.name ?? ""),
        roots,
      );
    case "copy_file":
      return copyFile(
        String(payload.source ?? ""),
        String(payload.destination ?? ""),
        roots,
      );
    case "move_file":
      return moveFile(
        String(payload.source ?? ""),
        String(payload.destination ?? ""),
        roots,
      );
    case "rename_file":
      return renameFile(
        String(payload.path ?? ""),
        String(payload.new_name ?? ""),
        roots,
      );
    case "create_text_file":
      return createTextFile(payload, roots);
    case "write_text_file":
      return writeTextFile(
        String(payload.path ?? ""),
        String(payload.content ?? ""),
        roots,
      );
    case "append_text_file":
      return appendTextFile(
        String(payload.path ?? ""),
        String(payload.content ?? ""),
        roots,
      );
    case "duplicate_file":
      return duplicateFile(String(payload.path ?? ""), roots);
    case "delete_file":
      return deleteFile(String(payload.path ?? ""), roots);
    case "delete_folder":
      return deleteFolder(String(payload.path ?? ""), roots);
    default: {
      const broker = await capabilityBrokerExecute(tool, payload, {
        approvedRoots: roots,
      });
      if (broker) return broker;
      const system = await windowsSystemExecute(tool, payload);
      if (system) return system;
      return {
        success: false,
        error: { code: "UNKNOWN_TOOL", message: "Unknown device tool." },
      };
    }
  }
}

async function getRunningApps(): Promise<DeviceToolResult> {
  if (process.platform !== "win32") {
    return {
      success: true,
      data: { apps: [], message: "Running apps available on Windows only." },
    };
  }
  try {
    // Fixed argv only — CONTROLLED OS API (never model-supplied)
    const { stdout } = await execFileAsync(
      "tasklist",
      ["/fo", "csv", "/nh"],
      { timeout: 8000, windowsHide: true },
    );
    const names = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const m = /^"([^"]+)"/.exec(line.trim());
      if (!m?.[1]) continue;
      const base = m[1].replace(/\.exe$/i, "").trim();
      if (!base || isBlockedAppName(base)) continue;
      names.add(base);
      if (names.size >= 40) break;
    }
    const apps = [...names];
    return {
      success: true,
      data: { apps, message: `Found ${apps.length} apps.`, activityLabel: "Apps listed" },
    };
  } catch {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not list apps." },
    };
  }
}

async function resolveInstalledApps(query: string): Promise<
  Array<{ name: string; target: string }>
> {
  if (process.platform !== "win32") return [];
  const q = query.toLowerCase();
  const startMenu = [
    path.join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs"),
  ];
  const matches: Array<{ name: string; target: string }> = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4 || matches.length >= 12) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!ent.name.toLowerCase().endsWith(".lnk")) continue;
      const name = ent.name.replace(/\.lnk$/i, "");
      if (!name.toLowerCase().includes(q) && q !== name.toLowerCase()) continue;
      try {
        // Electron shell.readShortcutLink
        const link = (shell as unknown as {
          readShortcutLink?: (p: string) => { target: string };
        }).readShortcutLink?.(full);
        const target = link?.target ?? full;
        if (isBlockedAppName(path.basename(target)) || isBlockedAppName(name)) {
          continue;
        }
        if (isBlockedExecutableExtension(target) && !target.toLowerCase().endsWith(".exe")) {
          continue;
        }
        // Block launching shells even via shortcut
        if (isBlockedAppName(path.basename(target))) continue;
        matches.push({ name, target });
      } catch {
        // ignore bad shortcuts
      }
    }
  }

  for (const root of startMenu) {
    if (root) await walk(root, 0);
  }
  return matches;
}

async function openApplication(appName: string): Promise<DeviceToolResult> {
  if (!appName.trim()) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "App name required." },
    };
  }
  if (isBlockedAppName(appName) || /[\\/]/.test(appName) || appName.toLowerCase().endsWith(".exe")) {
    return {
      success: false,
      error: {
        code: "APP_BLOCKED",
        message: "That application cannot be opened through Aurum.",
      },
    };
  }

  const matches = await resolveInstalledApps(appName.trim());
  if (matches.length === 0) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: `No installed app matched “${appName.trim()}”.` },
    };
  }
  if (matches.length > 1) {
    const exact = matches.filter(
      (m) => m.name.toLowerCase() === appName.trim().toLowerCase(),
    );
    if (exact.length !== 1) {
      return {
        success: false,
        error: {
          code: "AMBIGUOUS_MATCH",
          message: "Multiple apps matched. Ask which one to open.",
        },
        data: {
          candidates: matches.slice(0, 8).map((m) => ({ name: m.name })),
        },
      };
    }
    matches.splice(0, matches.length, exact[0]!);
  }

  const chosen = matches[0]!;
  if (isBlockedAppName(path.basename(chosen.target))) {
    return {
      success: false,
      error: { code: "APP_BLOCKED", message: "Blocked application target." },
    };
  }

  const err = await shell.openPath(chosen.target);
  if (err) {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not open application." },
    };
  }
  return {
    success: true,
    data: {
      app: chosen.name,
      message: `Opened ${chosen.name}.`,
      activityLabel: `Opening ${chosen.name}`,
    },
  };
}

async function openUrl(url: string): Promise<DeviceToolResult> {
  if (!isSafeUrl(url)) {
    return {
      success: false,
      error: { code: "INVALID_URL", message: "Only http(s) URLs are allowed." },
    };
  }
  await shell.openExternal(url);
  return {
    success: true,
    data: { url, message: "Opened URL.", activityLabel: "Opening URL" },
  };
}

async function listDirectory(
  dirPath: string,
  roots: ApprovedRoot[],
  limit: number,
): Promise<DeviceToolResult> {
  const gate = assertApprovedPath(dirPath, rootsPaths(roots));
  if (!gate.ok) return { success: false, error: { code: gate.code, message: gate.message } };
  try {
    const entries = await fs.readdir(gate.canonical, { withFileTypes: true });
    const items = entries.slice(0, Math.min(limit, MAX_LIST_ENTRIES)).map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : "file",
    }));
    return {
      success: true,
      data: {
        path: gate.canonical,
        entries: items,
        message: `${items.length} items.`,
        activityLabel: "Folder listed",
        surface: "file",
      },
    };
  } catch {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: "Directory not found." },
    };
  }
}

async function searchFiles(opts: {
  query: string;
  extension?: string;
  roots: ApprovedRoot[];
  limit: number;
}): Promise<DeviceToolResult> {
  const q = opts.query.toLowerCase();
  const ext = opts.extension?.startsWith(".")
    ? opts.extension.toLowerCase()
    : opts.extension
      ? `.${opts.extension.toLowerCase()}`
      : undefined;
  const results: Array<{
    name: string;
    relativePath: string;
    rootLabel: string;
    path: string;
  }> = [];

  async function walk(
    dir: string,
    root: ApprovedRoot,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_SEARCH_DEPTH || results.length >= opts.limit) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (results.length >= opts.limit) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, root, depth + 1);
        continue;
      }
      const name = ent.name;
      if (!name.toLowerCase().includes(q)) continue;
      if (ext && !name.toLowerCase().endsWith(ext)) continue;
      if (isBlockedExecutableExtension(name)) continue;
      const rel = path.relative(root.canonical_path, full);
      results.push({
        name,
        relativePath: rel.replace(/\\/g, " / "),
        rootLabel: root.label,
        path: normalizePath(full),
      });
    }
  }

  for (const root of opts.roots) {
    await walk(root.canonical_path, root, 0);
  }

  return {
    success: true,
    data: {
      files: results,
      count: results.length,
      message:
        results.length === 0
          ? "No matching files in approved folders."
          : `Found ${results.length} file${results.length === 1 ? "" : "s"}.`,
      activityLabel: "Files found",
      surface: "file",
    },
  };
}

async function readFile(
  filePath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const gate = assertApprovedPath(filePath, rootsPaths(roots));
  if (!gate.ok) return { success: false, error: { code: gate.code, message: gate.message } };
  if (!isTextReadableExtension(gate.canonical)) {
    return {
      success: false,
      error: {
        code: "UNSUPPORTED_FILE_TYPE",
        message: "Only text-like files can be read.",
      },
    };
  }
  const st = await fs.stat(gate.canonical);
  if (st.size > MAX_READ_FILE_BYTES) {
    return {
      success: false,
      error: {
        code: "UNSUPPORTED_FILE_TYPE",
        message: "File is too large to read.",
      },
    };
  }
  const content = await fs.readFile(gate.canonical, "utf8");
  return {
    success: true,
    data: {
      path: gate.canonical,
      content,
      message: "File read.",
      activityLabel: "File read",
    },
  };
}

async function openFile(
  filePath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const gate = assertApprovedPath(filePath, rootsPaths(roots));
  if (!gate.ok) return { success: false, error: { code: gate.code, message: gate.message } };
  if (!canOpenWithDefaultApp(gate.canonical)) {
    return {
      success: false,
      error: {
        code: "EXECUTABLE_BLOCKED",
        message: "Executable or script files cannot be opened.",
      },
    };
  }
  const err = await shell.openPath(gate.canonical);
  if (err) {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not open file." },
    };
  }
  return {
    success: true,
    data: {
      path: gate.canonical,
      message: "Opened file.",
      activityLabel: "Opening file",
      surface: "file",
    },
  };
}

async function openFolder(
  folderPath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const gate = assertApprovedPath(folderPath, rootsPaths(roots));
  if (!gate.ok) return { success: false, error: { code: gate.code, message: gate.message } };
  const err = await shell.openPath(gate.canonical);
  if (err) {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not open folder." },
    };
  }
  return {
    success: true,
    data: {
      path: gate.canonical,
      message: "Opened folder.",
      activityLabel: "Opening folder",
    },
  };
}

async function createFolder(
  parentPath: string,
  name: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const safeName = sanitizeFileName(name);
  if (!safeName) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid folder name." },
    };
  }
  const gate = assertApprovedPath(parentPath, rootsPaths(roots));
  if (!gate.ok) return { success: false, error: { code: gate.code, message: gate.message } };
  const dest = path.join(gate.canonical, safeName);
  const destGate = assertApprovedPath(dest, rootsPaths(roots));
  if (!destGate.ok) {
    return { success: false, error: { code: destGate.code, message: destGate.message } };
  }
  await fs.mkdir(destGate.canonical, { recursive: true });
  return {
    success: true,
    data: {
      path: destGate.canonical,
      message: `Created folder ${safeName}.`,
      activityLabel: "Folder created",
    },
  };
}

async function copyFile(
  source: string,
  destination: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const src = assertApprovedPath(source, rootsPaths(roots));
  const dst = assertApprovedPath(destination, rootsPaths(roots));
  if (!src.ok) return { success: false, error: { code: src.code, message: src.message } };
  if (!dst.ok) return { success: false, error: { code: dst.code, message: dst.message } };
  if (isBlockedExecutableExtension(src.canonical) || isBlockedExecutableExtension(dst.canonical)) {
    return {
      success: false,
      error: { code: "EXECUTABLE_BLOCKED", message: "Executable files are blocked." },
    };
  }
  if (fsSync.existsSync(dst.canonical)) {
    return {
      success: false,
      error: { code: "CONFLICT", message: "Destination already exists." },
    };
  }
  await fs.copyFile(src.canonical, dst.canonical);
  return {
    success: true,
    data: {
      source: src.canonical,
      destination: dst.canonical,
      message: "File copied.",
      activityLabel: "File copied",
    },
  };
}

async function moveFile(
  source: string,
  destination: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const src = assertApprovedPath(source, rootsPaths(roots));
  const dst = assertApprovedPath(destination, rootsPaths(roots));
  if (!src.ok) return { success: false, error: { code: src.code, message: src.message } };
  if (!dst.ok) return { success: false, error: { code: dst.code, message: dst.message } };
  if (isBlockedExecutableExtension(src.canonical) || isBlockedExecutableExtension(dst.canonical)) {
    return {
      success: false,
      error: { code: "EXECUTABLE_BLOCKED", message: "Executable files are blocked." },
    };
  }
  if (fsSync.existsSync(dst.canonical)) {
    return {
      success: false,
      error: { code: "CONFLICT", message: "Destination already exists." },
    };
  }
  await fs.rename(src.canonical, dst.canonical);
  return {
    success: true,
    data: {
      source: src.canonical,
      destination: dst.canonical,
      message: "File moved.",
      activityLabel: "File moved",
    },
  };
}

async function renameFile(
  filePath: string,
  newName: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const safeName = sanitizeFileName(newName);
  if (!safeName) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid new name." },
    };
  }
  const src = assertApprovedPath(filePath, rootsPaths(roots));
  if (!src.ok) return { success: false, error: { code: src.code, message: src.message } };
  if (isBlockedExecutableExtension(src.canonical) || isBlockedExecutableExtension(safeName)) {
    return {
      success: false,
      error: {
        code: "EXECUTABLE_BLOCKED",
        message: "Cannot rename to or from an executable type.",
      },
    };
  }
  const dest = path.join(path.dirname(src.canonical), safeName);
  const dst = assertApprovedPath(dest, rootsPaths(roots));
  if (!dst.ok) return { success: false, error: { code: dst.code, message: dst.message } };
  if (fsSync.existsSync(dst.canonical)) {
    return {
      success: false,
      error: { code: "CONFLICT", message: "A file with that name already exists." },
    };
  }
  await fs.rename(src.canonical, dst.canonical);
  return {
    success: true,
    data: {
      path: dst.canonical,
      message: `Renamed to ${safeName}.`,
      activityLabel: "File renamed",
    },
  };
}

async function createTextFile(
  payload: Record<string, unknown>,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const parent = String(payload.parent_path ?? "");
  const name = sanitizeFileName(String(payload.name ?? ""));
  const content = typeof payload.content === "string" ? payload.content : "";
  if (!name || !isTextReadableExtension(name)) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Create text files with a safe text extension only.",
      },
    };
  }
  const parentCheck = assertApprovedPath(parent, rootsPaths(roots));
  if (!parentCheck.ok) {
    return {
      success: false,
      error: { code: parentCheck.code, message: parentCheck.message },
    };
  }
  const full = path.join(parentCheck.canonical, name);
  const dest = assertApprovedPath(full, rootsPaths(roots));
  if (!dest.ok) {
    return { success: false, error: { code: dest.code, message: dest.message } };
  }
  if (fsSync.existsSync(dest.canonical)) {
    return {
      success: false,
      error: { code: "CONFLICT", message: "File already exists." },
    };
  }
  await fs.writeFile(dest.canonical, content, "utf8");
  return {
    success: true,
    data: { path: dest.canonical, activityLabel: "File created" },
  };
}

async function writeTextFile(
  filePath: string,
  content: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const check = assertApprovedPath(filePath, rootsPaths(roots));
  if (!check.ok) {
    return { success: false, error: { code: check.code, message: check.message } };
  }
  if (!isTextReadableExtension(check.canonical)) {
    return {
      success: false,
      error: { code: "UNSUPPORTED_TYPE", message: "Only text files can be written." },
    };
  }
  if (Buffer.byteLength(content, "utf8") > MAX_READ_FILE_BYTES * 4) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Content too large." },
    };
  }
  await fs.writeFile(check.canonical, content, "utf8");
  return {
    success: true,
    data: { path: check.canonical, activityLabel: "File written" },
  };
}

async function appendTextFile(
  filePath: string,
  content: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const check = assertApprovedPath(filePath, rootsPaths(roots));
  if (!check.ok) {
    return { success: false, error: { code: check.code, message: check.message } };
  }
  if (!isTextReadableExtension(check.canonical)) {
    return {
      success: false,
      error: { code: "UNSUPPORTED_TYPE", message: "Only text files can be appended." },
    };
  }
  await fs.appendFile(check.canonical, content, "utf8");
  return {
    success: true,
    data: { path: check.canonical, activityLabel: "File appended" },
  };
}

async function duplicateFile(
  filePath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const src = assertApprovedPath(filePath, rootsPaths(roots));
  if (!src.ok) return { success: false, error: { code: src.code, message: src.message } };
  if (isBlockedExecutableExtension(src.canonical)) {
    return {
      success: false,
      error: { code: "EXECUTABLE_BLOCKED", message: "Executable files are blocked." },
    };
  }
  const ext = path.extname(src.canonical);
  const base = path.basename(src.canonical, ext);
  let destPath = path.join(path.dirname(src.canonical), `${base} copy${ext}`);
  let i = 2;
  while (fsSync.existsSync(destPath) && i < 50) {
    destPath = path.join(path.dirname(src.canonical), `${base} copy ${i}${ext}`);
    i += 1;
  }
  const dst = assertApprovedPath(destPath, rootsPaths(roots));
  if (!dst.ok) return { success: false, error: { code: dst.code, message: dst.message } };
  await fs.copyFile(src.canonical, dst.canonical);
  return {
    success: true,
    data: { path: dst.canonical, activityLabel: "File duplicated" },
  };
}

async function deleteFile(
  filePath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const check = assertApprovedPath(filePath, rootsPaths(roots));
  if (!check.ok) {
    return { success: false, error: { code: check.code, message: check.message } };
  }
  if (isBlockedExecutableExtension(check.canonical)) {
    return {
      success: false,
      error: { code: "EXECUTABLE_BLOCKED", message: "Executable files are blocked." },
    };
  }
  const st = await fs.stat(check.canonical);
  if (!st.isFile()) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Path is not a file." },
    };
  }
  await fs.unlink(check.canonical);
  return {
    success: true,
    data: { path: check.canonical, activityLabel: "File deleted" },
  };
}

async function deleteFolder(
  folderPath: string,
  roots: ApprovedRoot[],
): Promise<DeviceToolResult> {
  const check = assertApprovedPath(folderPath, rootsPaths(roots));
  if (!check.ok) {
    return { success: false, error: { code: check.code, message: check.message } };
  }
  // Never delete an approved root itself
  const rootsLower = rootsPaths(roots).map((r) =>
    normalizePath(r).toLowerCase(),
  );
  if (rootsLower.includes(normalizePath(check.canonical).toLowerCase())) {
    return {
      success: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "Cannot delete an approved root folder.",
      },
    };
  }
  const st = await fs.stat(check.canonical);
  if (!st.isDirectory()) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Path is not a folder." },
    };
  }
  await fs.rm(check.canonical, { recursive: true, force: false });
  return {
    success: true,
    data: { path: check.canonical, activityLabel: "Folder deleted" },
  };
}
