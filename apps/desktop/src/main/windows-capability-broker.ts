/**
 * WindowsCapabilityBroker — central typed capability router.
 * No arbitrary command strings. Modules: apps, windows, files, system,
 * audio, media, display, clipboard, notifications, processes, power,
 * input, screenshots, browser, workspace.
 */
import {
  clearClipboard,
  getClipboardText,
  setClipboardText,
  writeClipboardImageFromPath,
} from "./windows-clipboard";
import {
  findFilesByDate,
  findLargestFile,
  findNewestFile,
  getFileMetadata,
  revealInExplorer,
} from "./windows-files-extra";
import {
  pressShortcut,
  type ShortcutAction,
  uiAutomationUnsupported,
} from "./windows-input";
import { listProcesses, terminateProcess } from "./windows-processes";
import {
  captureMonitor,
  capturePrimaryDisplay,
  captureWindowScreenshot,
} from "./windows-screenshot";
import { recordAudit } from "./windows-audit";
import {
  rememberApp,
  rememberMonitor,
  rememberWindow,
  resolveApp,
  resolveFile,
  resolveMonitor,
  resolveScreenshot,
  resolveWindow,
} from "./trusted-refs";
import type { ApprovedRoot, DeviceToolResult } from "./windows-tools";
import {
  bringWindowToFront,
  centerWindow,
  enumerateOpenWindows,
  getWindowRect,
  isWindow,
  moveWindowToDisplay,
  postCloseWindow,
  setForegroundWindow,
  showWindow,
  snapWindow,
} from "./windows-win32";
import { shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import {
  isBlockedAppName,
  isBlockedExecutableExtension,
  isSafeUrl,
} from "./security";

export type BrokerContext = {
  approvedRoots: ApprovedRoot[];
  executionId?: string;
  generationId?: string;
};

const MUTATING_PERMISSION: Record<string, string> = {
  set_clipboard_text: "SAFE_WRITE",
  clear_clipboard: "SAFE_WRITE",
  copy_image_to_clipboard: "SAFE_WRITE",
  capture_screenshot: "SAFE_WRITE",
  capture_monitor_screenshot: "SAFE_WRITE",
  snap_window_left: "SAFE_WRITE",
  snap_window_right: "SAFE_WRITE",
  center_window: "SAFE_WRITE",
  bring_window_to_front: "SAFE_WRITE",
  move_window_to_monitor: "SAFE_WRITE",
  focus_application: "SAFE_WRITE",
  close_application: "SAFE_WRITE",
  open_known_application: "SAFE_WRITE",
  terminate_process: "CONFIRM",
  press_shortcut: "SAFE_WRITE",
  show_notification: "SAFE_WRITE",
  open_search: "SAFE_WRITE",
  open_file_with_app: "SAFE_WRITE",
  reveal_in_explorer: "SAFE_WRITE",
  run_workspace_routine: "SAFE_WRITE",
  vault_write_managed_file: "SAFE_WRITE",
};

/**
 * Try capability-broker tools. Returns null if the tool is not owned here
 * (caller falls through to legacy adapters).
 */
export async function capabilityBrokerExecute(
  tool: string,
  payload: Record<string, unknown>,
  ctx: BrokerContext,
): Promise<DeviceToolResult | null> {
  const started = Date.now();
  const handled = await dispatch(tool, payload, ctx);
  if (handled === null) return null;

  const permission = MUTATING_PERMISSION[tool];
  if (permission) {
    recordAudit({
      tool,
      permission,
      success: handled.success,
      durationMs: Date.now() - started,
      argsSummary: payload,
      errorCode: handled.error?.code,
      executionId: ctx.executionId,
      generationId: ctx.generationId,
    });
  }
  return handled;
}

async function dispatch(
  tool: string,
  payload: Record<string, unknown>,
  ctx: BrokerContext,
): Promise<DeviceToolResult | null> {
  switch (tool) {
    // —— Clipboard ——
    case "get_clipboard_text":
      return getClipboardText();
    case "set_clipboard_text":
      return setClipboardText(String(payload.text ?? ""));
    case "clear_clipboard":
      return clearClipboard();
    case "copy_image_to_clipboard":
      return copyImage(payload, ctx);

    // —— Screenshots ——
    case "capture_screenshot":
      return capturePrimaryDisplay();
    case "capture_monitor_screenshot":
      return captureMonitor(payload.monitorReference);
    case "capture_window_screenshot":
      return captureWindowScreenshot(payload.windowReference);

    // —— Display / window layout ——
    case "list_monitors":
      return listMonitors();
    case "get_window_bounds":
      return getBounds(payload.windowReference);
    case "snap_window_left":
      return snap(payload.windowReference, "left", payload.monitorReference);
    case "snap_window_right":
      return snap(payload.windowReference, "right", payload.monitorReference);
    case "center_window":
      return center(payload.windowReference, payload.monitorReference);
    case "bring_window_to_front":
      return bringFront(payload.windowReference);
    case "move_window_to_monitor":
      return moveToMonitor(
        payload.windowReference,
        payload.monitorReference,
        Boolean(payload.maximize),
      );

    // —— Apps ——
    case "list_known_applications":
      return listKnownApps(String(payload.query ?? ""), Number(payload.limit ?? 30));
    case "focus_application":
      return focusApplication(String(payload.app ?? ""));
    case "close_application":
      return closeApplication(String(payload.app ?? ""));
    case "open_known_application":
      return openKnownApp(payload.appReference);
    case "open_file_with_app":
      return openFileWithApp(payload, ctx);

    // —— Files ——
    case "find_newest_file":
      return findNewestFile({
        roots: ctx.approvedRoots,
        extension: payload.extension ? String(payload.extension) : undefined,
        limit: Number(payload.limit ?? 10),
      });
    case "find_largest_file":
      return findLargestFile({
        roots: ctx.approvedRoots,
        extension: payload.extension ? String(payload.extension) : undefined,
        limit: Number(payload.limit ?? 10),
      });
    case "find_files_by_date":
      return findFilesByDate({
        roots: ctx.approvedRoots,
        date: String(payload.date ?? ""),
        extension: payload.extension ? String(payload.extension) : undefined,
        limit: Number(payload.limit ?? 25),
      });
    case "get_file_metadata":
      return getFileMetadata(String(payload.path ?? ""), ctx.approvedRoots);
    case "vault_write_managed_file": {
      const { vaultWriteManagedFile } = await import("./vault-write");
      return vaultWriteManagedFile(payload, ctx.approvedRoots);
    }
    case "reveal_in_explorer":
      return revealInExplorer(String(payload.path ?? ""), ctx.approvedRoots);
    case "open_trusted_file":
      return openTrustedFile(payload.fileReference);

    // —— Processes ——
    case "list_processes":
      return listProcesses(Number(payload.limit ?? 40));
    case "terminate_process":
      return terminateProcess(payload.processReference);

    // —— Input ——
    case "press_shortcut":
      return pressShortcut(String(payload.action ?? "") as ShortcutAction);
    case "inspect_ui_elements":
    case "invoke_ui_element":
    case "set_ui_element_text":
      return uiAutomationUnsupported(tool);

    // —— Notifications ——
    case "show_notification":
      return showNotification(
        String(payload.title ?? "Aurum"),
        String(payload.body ?? ""),
      );

    // —— Browser ——
    case "open_search":
      return openSearch(String(payload.query ?? ""));

    // —— Workspace ——
    case "run_workspace_routine":
      return runWorkspaceRoutine(String(payload.routine ?? ""), ctx);

    default:
      return null;
  }
}

function listMonitors(): DeviceToolResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { screen } = require("electron") as typeof import("electron");
    const primary = screen.getPrimaryDisplay();
    const monitors = screen.getAllDisplays().map((d, index) => {
      const monitorReference = rememberMonitor({
        displayId: d.id,
        index,
        label: d.label || `Display ${index + 1}`,
        bounds: {
          x: d.bounds.x,
          y: d.bounds.y,
          width: d.bounds.width,
          height: d.bounds.height,
        },
        scaleFactor: d.scaleFactor,
        primary: d.id === primary.id,
      });
      return {
        monitorReference,
        name: d.label || `Display ${index + 1}`,
        index: index + 1,
        width: d.size.width,
        height: d.size.height,
        scaleFactor: d.scaleFactor,
        refreshRate: d.displayFrequency ?? null,
        primary: d.id === primary.id,
        bounds: d.bounds,
      };
    });
    return {
      success: true,
      data: { monitors, activityLabel: "Listed monitors" },
    };
  } catch {
    return {
      success: false,
      error: { code: "UNSUPPORTED", message: "Could not list monitors." },
    };
  }
}

function resolveDisplayBounds(monitorReference?: unknown): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (monitorReference) {
    const mon = resolveMonitor(monitorReference);
    if (mon) return mon.bounds;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { screen } = require("electron") as typeof import("electron");
    const b = screen.getPrimaryDisplay().bounds;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return null;
  }
}

function requireWindow(ref: unknown): DeviceToolResult | { hwnd: number; title: string } {
  const win = resolveWindow(ref);
  if (!win) {
    return {
      success: false,
      error: {
        code: "WINDOW_NOT_FOUND",
        message: "Invalid or expired window reference. List windows again.",
      },
    };
  }
  const hwnd = Math.trunc(win.hwnd);
  if (!Number.isFinite(hwnd) || hwnd <= 0 || !isWindow(hwnd)) {
    return {
      success: false,
      error: {
        code: "WINDOW_NOT_FOUND",
        message: "That window is no longer available.",
      },
    };
  }
  return { hwnd, title: win.title };
}

function getBounds(ref: unknown): DeviceToolResult {
  const w = requireWindow(ref);
  if ("success" in w) return w;
  const rect = getWindowRect(w.hwnd);
  if (!rect) {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not read window bounds." },
    };
  }
  return {
    success: true,
    data: { title: w.title, bounds: rect, activityLabel: "Window bounds" },
  };
}

function snap(
  windowRef: unknown,
  side: "left" | "right",
  monitorRef?: unknown,
): DeviceToolResult {
  const w = requireWindow(windowRef);
  if ("success" in w) return w;
  const display = resolveDisplayBounds(monitorRef);
  if (!display) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid monitor reference. List monitors again.",
      },
    };
  }
  showWindow(w.hwnd, 9);
  snapWindow(w.hwnd, side, display);
  setForegroundWindow(w.hwnd);
  return {
    success: true,
    data: {
      title: w.title,
      side,
      activityLabel: `Snap ${side} · ${w.title}`,
    },
  };
}

function center(windowRef: unknown, monitorRef?: unknown): DeviceToolResult {
  const w = requireWindow(windowRef);
  if ("success" in w) return w;
  const display = resolveDisplayBounds(monitorRef);
  if (!display) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid monitor reference." },
    };
  }
  centerWindow(w.hwnd, display);
  setForegroundWindow(w.hwnd);
  return {
    success: true,
    data: { title: w.title, activityLabel: `Centered · ${w.title}` },
  };
}

function bringFront(windowRef: unknown): DeviceToolResult {
  const w = requireWindow(windowRef);
  if ("success" in w) return w;
  bringWindowToFront(w.hwnd);
  return {
    success: true,
    data: { title: w.title, activityLabel: `Front · ${w.title}` },
  };
}

function moveToMonitor(
  windowRef: unknown,
  monitorRef: unknown,
  maximize: boolean,
): DeviceToolResult {
  const w = requireWindow(windowRef);
  if ("success" in w) return w;
  const mon = resolveMonitor(monitorRef);
  if (!mon) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired monitor reference. Call list_monitors first.",
      },
    };
  }
  moveWindowToDisplay(w.hwnd, mon.bounds, maximize);
  return {
    success: true,
    data: {
      title: w.title,
      monitor: mon.label,
      maximized: maximize,
      activityLabel: `Moved · ${w.title}`,
    },
    message: `Moved “${w.title}” to ${mon.label}.`,
  };
}

async function listKnownApps(
  query: string,
  limit: number,
): Promise<DeviceToolResult> {
  if (process.platform !== "win32") {
    return {
      success: false,
      error: { code: "UNSUPPORTED", message: "Windows only." },
    };
  }
  const q = query.toLowerCase().trim();
  const startMenu = [
    path.join(
      process.env.PROGRAMDATA ?? "C:\\ProgramData",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
    ),
    path.join(
      process.env.APPDATA ?? "",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
    ),
  ];
  const apps: Array<{ appReference: string; displayName: string }> = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4 || apps.length >= Math.min(limit, 60)) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (apps.length >= Math.min(limit, 60)) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!ent.name.toLowerCase().endsWith(".lnk")) continue;
      const displayName = ent.name.replace(/\.lnk$/i, "");
      if (q && !displayName.toLowerCase().includes(q)) continue;
      if (isBlockedAppName(displayName)) continue;
      try {
        const link = (
          shell as unknown as {
            readShortcutLink?: (p: string) => { target: string };
          }
        ).readShortcutLink?.(full);
        const target = link?.target ?? full;
        if (isBlockedAppName(path.basename(target))) continue;
        if (
          isBlockedExecutableExtension(target) &&
          !target.toLowerCase().endsWith(".exe")
        ) {
          continue;
        }
        const appReference = rememberApp({ displayName, targetPath: target });
        apps.push({ appReference, displayName });
      } catch {
        /* ignore */
      }
    }
  }

  for (const root of startMenu) {
    if (root) await walk(root, 0);
  }

  return {
    success: true,
    data: { apps, activityLabel: "Listed applications" },
    message: `Found ${apps.length} application(s).`,
  };
}

async function openKnownApp(appReference: unknown): Promise<DeviceToolResult> {
  const app = resolveApp(appReference);
  if (!app) {
    return {
      success: false,
      error: {
        code: "APPLICATION_NOT_FOUND",
        message: "Invalid or expired app reference. List applications again.",
      },
    };
  }
  if (isBlockedAppName(app.displayName) || isBlockedAppName(path.basename(app.targetPath))) {
    return {
      success: false,
      error: { code: "APP_BLOCKED", message: "That application is blocked." },
    };
  }
  const err = await shell.openPath(app.targetPath);
  if (err) {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not open application." },
    };
  }
  return {
    success: true,
    data: {
      app: app.displayName,
      activityLabel: `Opening ${app.displayName}`,
    },
  };
}

function focusApplication(appName: string): DeviceToolResult {
  const q = appName.trim().toLowerCase();
  if (!q) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "App name required." },
    };
  }
  if (isBlockedAppName(q)) {
    return {
      success: false,
      error: { code: "APP_BLOCKED", message: "Blocked application." },
    };
  }
  const matches = enumerateOpenWindows(60).filter(
    (w) =>
      w.title.toLowerCase().includes(q) ||
      String(w.processId).includes(q),
  );
  // Prefer title match containing app name
  const win = matches[0];
  if (!win) {
    return {
      success: false,
      error: {
        code: "APPLICATION_NOT_FOUND",
        message: `No open window matched “${appName.trim()}”.`,
      },
    };
  }
  const referenceId = rememberWindow({
    hwnd: win.hwnd,
    title: win.title,
    processName: `pid:${win.processId}`,
    processId: win.processId,
  });
  showWindow(win.hwnd, 9);
  setForegroundWindow(win.hwnd);
  return {
    success: true,
    data: {
      windowReference: referenceId,
      title: win.title,
      activityLabel: `Focus · ${win.title}`,
    },
  };
}

function closeApplication(appName: string): DeviceToolResult {
  const focused = focusApplication(appName);
  if (!focused.success || !focused.data?.windowReference) {
    return focused;
  }
  const win = resolveWindow(focused.data.windowReference);
  if (!win) {
    return {
      success: false,
      error: { code: "WINDOW_NOT_FOUND", message: "Window disappeared." },
    };
  }
  postCloseWindow(Math.trunc(win.hwnd));
  return {
    success: true,
    data: {
      title: win.title,
      activityLabel: `Closing · ${win.title}`,
    },
    message: `Closing “${win.title}”.`,
  };
}

async function openFileWithApp(
  payload: Record<string, unknown>,
  ctx: BrokerContext,
): Promise<DeviceToolResult> {
  let filePath = String(payload.path ?? "");
  if (payload.fileReference) {
    const f = resolveFile(payload.fileReference);
    if (!f) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid or expired file reference.",
        },
      };
    }
    filePath = f.path;
  }
  if (!filePath) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "path or fileReference required." },
    };
  }
  // Reuse open_file semantics via shell — path must be under approved roots
  const { assertApprovedPath, canOpenWithDefaultApp } = await import("./security");
  const gate = assertApprovedPath(
    filePath,
    ctx.approvedRoots.map((r) => r.canonical_path),
  );
  if (!gate.ok) {
    return { success: false, error: { code: gate.code, message: gate.message } };
  }
  if (!canOpenWithDefaultApp(gate.canonical)) {
    return {
      success: false,
      error: { code: "APP_BLOCKED", message: "That file type cannot be opened." },
    };
  }
  const appName = payload.app ? String(payload.app) : "";
  if (appName) {
    // Open app first, then file with default handler (typed — no arbitrary exe)
    // Opening with a specific app without shell is limited; open file with default.
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
      activityLabel: "Opening file",
    },
  };
}

async function openTrustedFile(fileReference: unknown): Promise<DeviceToolResult> {
  const f = resolveFile(fileReference);
  if (!f) {
    return {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid or expired file reference.",
      },
    };
  }
  const err = await shell.openPath(f.path);
  if (err) {
    return {
      success: false,
      error: { code: "EXECUTION_FAILED", message: "Could not open file." },
    };
  }
  return {
    success: true,
    data: { name: f.name, path: f.path, activityLabel: `Opening ${f.name}` },
  };
}

async function copyImage(
  payload: Record<string, unknown>,
  ctx: BrokerContext,
): Promise<DeviceToolResult> {
  let filePath = String(payload.path ?? "");
  if (payload.screenshotReference) {
    const shot = resolveScreenshot(payload.screenshotReference);
    if (!shot) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid or expired screenshot reference.",
        },
      };
    }
    filePath = shot.path;
  } else if (payload.fileReference) {
    const f = resolveFile(payload.fileReference);
    if (!f) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid or expired file reference.",
        },
      };
    }
    filePath = f.path;
  }
  if (!filePath) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Image reference required." },
    };
  }
  // Screenshots live under Pictures/Aurum Captures — allow those without root
  const capturesHint = path.join("Aurum Captures");
  if (!filePath.includes(capturesHint)) {
    const { assertApprovedPath } = await import("./security");
    const gate = assertApprovedPath(
      filePath,
      ctx.approvedRoots.map((r) => r.canonical_path),
    );
    if (!gate.ok) {
      return { success: false, error: { code: gate.code, message: gate.message } };
    }
    return writeClipboardImageFromPath(gate.canonical);
  }
  return writeClipboardImageFromPath(filePath);
}

function showNotification(title: string, body: string): DeviceToolResult {
  const t = title.slice(0, 120);
  const b = body.slice(0, 500);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Notification } = require("electron") as typeof import("electron");
    if (Notification.isSupported()) {
      new Notification({ title: t || "Aurum", body: b }).show();
    }
    return {
      success: true,
      data: { activityLabel: "Notification" },
      message: "Notification shown.",
    };
  } catch {
    return {
      success: false,
      error: {
        code: "EXECUTION_FAILED",
        message: "Could not show notification.",
      },
    };
  }
}

async function openSearch(query: string): Promise<DeviceToolResult> {
  const q = query.trim();
  if (!q || q.length > 300) {
    return {
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Search query required (max 300)." },
    };
  }
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  if (!isSafeUrl(url)) {
    return {
      success: false,
      error: { code: "INVALID_URL", message: "Invalid search URL." },
    };
  }
  await shell.openExternal(url);
  return {
    success: true,
    data: { query: q, activityLabel: "Opening search" },
    message: `Searching for “${q}”.`,
  };
}

/**
 * Named workspace routines — composed only from typed internal steps.
 * No scripts. No model-supplied command lists.
 */
async function runWorkspaceRoutine(
  routine: string,
  _ctx: BrokerContext,
): Promise<DeviceToolResult> {
  const name = routine.trim().toLowerCase().replace(/\s+/g, "_");
  const steps: string[] = [];

  if (name === "focus_mode" || name === "work_mode") {
    // Soft routine: mute is intentionally NOT automatic — only open/focus helpers
    steps.push("Listed as work_mode — open Cursor/Chrome/Spotify via separate tools as needed.");
    return {
      success: true,
      data: {
        routine: name,
        steps,
        hint: "Compose with open_application, move_window_to_monitor, set_system_volume, media_play_pause.",
        activityLabel: "Workspace routine",
      },
      message:
        "Work mode is a planner hint. Use open_application / window / volume tools for each step.",
    };
  }

  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: `Unknown workspace routine “${routine}”. Supported: work_mode, focus_mode.`,
    },
  };
}
