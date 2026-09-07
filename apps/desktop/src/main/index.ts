import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";

// Trusted local overlay TTS after async PTT — do not require a click each turn.
app.commandLine.appendSwitch(
  "autoplay-policy",
  "no-user-gesture-required",
);
// Keep overlay TTS audible if the window loses focus / is briefly hidden.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
import { DeviceBridge } from "./bridge";
import { getAurumWebUrl, loadDesktopEnv } from "./config";
import {
  clearDeviceCredential,
  loadDeviceCredential,
  saveDeviceCredential,
  type DeviceCredential,
} from "./credentials";
import { OverlayChatBridge } from "./overlay-chat";
import { VoiceBridge } from "./voice-bridge";
import { VoiceHotkeyController } from "./voice-hotkey";
import { installMediaPermissionHandlers } from "./voice-permissions";
import { authenticatedDeviceFetch } from "./authenticated-device-fetch";
import { appendVoiceLog, voiceLogFilePath, debugWavPath } from "./voice-log";
import { getMasterAudioState } from "./windows-audio";
import {
  AURUM_AUTOSTART_FLAG,
  mainWindowConversationUrl,
  mainWindowEntryUrl,
  resolveSecondInstanceAction,
  resolveStartupWindowAction,
} from "./launch-behavior";
import {
  clampOverlaySize,
  OVERLAY_IDLE_SIZE,
  positionOverlayBounds,
  resolveOverlaySize,
  type OverlayLayoutMode,
  type OverlaySize,
} from "./overlay-layout";
import { DesktopUpdater } from "./updater";
import type { UpdaterPublicState } from "./updater-state";
import { buildTrayUpdateMenu } from "./updater-tray";

/**
 * Aurum Console — Windows companion (device bridge + auto-updater).
 * Product/assistant name remains Aurum; this app's Windows identity is Aurum Console.
 * Manual launch → full main window; Ctrl+Space → overlay only.
 */

loadDesktopEnv();

/** Windows application identity (Start Menu, window title, tray tooltip). */
const PRODUCT = {
  name: "Aurum Console",
} as const;

function brandAssetPath(...parts: string[]): string {
  return path.join(__dirname, "..", "assets", ...parts);
}

function loadBrandNativeImage(
  ...candidates: string[]
): Electron.NativeImage {
  for (const file of candidates) {
    const full = brandAssetPath(file);
    if (!fs.existsSync(full)) continue;
    const img = nativeImage.createFromPath(full);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createEmpty();
}

const DEFAULT_DESKTOP_HOTKEY = "CommandOrControl+Space";
const BOTTOM_GAP_PX = 36;

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bridge: DeviceBridge | null = null;
let overlayChat: OverlayChatBridge | null = null;
let voiceBridge: VoiceBridge | null = null;
let voiceHotkey: VoiceHotkeyController | null = null;
let overlayVisibleAtPttPress = false;
let overlayFocusedAtPttPress = false;
let overlayLayoutMode: OverlayLayoutMode = "idle";
let overlayContentHeightPx = 0;
let isQuitting = false;
let desktopUpdater: DesktopUpdater | null = null;
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null;

const OpenExternalSchema = z.object({
  url: z.string().url(),
});

/** Single-instance: second Start Menu / Aurum.exe launch opens the full app. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!app.isReady()) return;
    if (resolveSecondInstanceAction() === "show-main") {
      showMainWindow();
    }
  });
}

function logDevice(event: string, extra?: Record<string, unknown>): void {
  console.info("[aurum:device]", { event, ...extra });
}

function ensureBridge(): DeviceBridge | null {
  const cred = loadDeviceCredential();
  if (!cred) return null;
  if (!bridge) {
    bridge = new DeviceBridge(cred, (msg, extra) => logDevice(msg, extra));
    bridge.start();
  }
  return bridge;
}

function ensureOverlayChat(): OverlayChatBridge {
  if (!overlayChat) {
    overlayChat = new OverlayChatBridge(
      () => loadDeviceCredential(),
      (payload) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send("aurum:overlay-chat-event", payload);
        }
      },
    );
  }
  return overlayChat;
}

function ensureVoiceBridge(): VoiceBridge {
  if (!voiceBridge) {
    voiceBridge = new VoiceBridge(() => loadDeviceCredential());
  }
  return voiceBridge;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: PRODUCT.name,
    icon: brandAssetPath("icon.ico"),
    backgroundColor: "#0a0a0b",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void win.loadURL(mainWindowEntryUrl(getAurumWebUrl()));
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("close", (e) => {
    if (tray && !isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

/** Full Aurum application (not the Ctrl+Space overlay). */
function showMainWindow(opts?: {
  conversationId?: string | null;
  hideOverlayFirst?: boolean;
}): void {
  if (opts?.hideOverlayFirst) {
    hideOverlayImmediate();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }

  const conversationId = opts?.conversationId;
  if (conversationId) {
    const target = mainWindowConversationUrl(getAurumWebUrl(), conversationId);
    void mainWindow.loadURL(target);
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  // Brief always-on-top to beat focus-stealing / overlay z-order, then clear.
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.focus();
  if (process.platform === "win32") {
    mainWindow.moveTop();
  }
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.focus();
    }
  }, 250);
}

function activeDisplay() {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point);
}

function currentOverlaySize(): OverlaySize {
  const { workArea } = activeDisplay();
  return resolveOverlaySize({
    mode: overlayLayoutMode,
    contentHeightPx: overlayContentHeightPx,
    workArea: { width: workArea.width, height: workArea.height },
  });
}

function positionOverlay(
  win: BrowserWindow,
  size: OverlaySize,
): void {
  const display = activeDisplay();
  const bounds = positionOverlayBounds(size, display.workArea, BOTTOM_GAP_PX);
  win.setBounds(bounds);
}

function applyOverlayLayout(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayWindow.isVisible()) return;
  positionOverlay(overlayWindow, currentOverlaySize());
}

function createOverlayWindow(): BrowserWindow {
  const idle = clampOverlaySize(OVERLAY_IDLE_SIZE, {
    width: 1920,
    height: 1080,
  });
  const win = new BrowserWindow({
    width: idle.width,
    height: idle.height,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    focusable: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Overlay is a trusted local file:// surface; allow post-PTT TTS without a click.
      autoplayPolicy: "no-user-gesture-required",
      backgroundThrottling: false,
    },
  });

  // Stay visible above normal apps without stealing permanent focus ownership.
  // Clicking another app may blur Aurum; do not hide or remount on blur.
  win.setAlwaysOnTop(true, "screen-saver");
  win.webContents.setBackgroundThrottling(false);
  try {
    win.webContents.setAudioMuted(false);
  } catch {
    // ignore
  }
  win.on("blur", () => {
    if (!win.isDestroyed() && win.isVisible()) {
      win.setAlwaysOnTop(true, "screen-saver");
    }
  });

  positionOverlay(win, idle);
  void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  return win;
}

function ensureOverlayAudioReady(): {
  audioMuted: boolean | null;
} {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return { audioMuted: null };
  }
  try {
    overlayWindow.webContents.setBackgroundThrottling(false);
  } catch {
    // ignore
  }
  try {
    overlayWindow.webContents.setAudioMuted(false);
  } catch {
    // ignore
  }
  let audioMuted: boolean | null = null;
  try {
    audioMuted = overlayWindow.webContents.isAudioMuted();
  } catch {
    audioMuted = null;
  }
  appendVoiceLog("overlay_audio", {
    webcontents_audio_muted: audioMuted,
  });
  return { audioMuted };
}

function showOverlay(): void {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }
  positionOverlay(overlayWindow, currentOverlaySize());
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  ensureOverlayAudioReady();
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.webContents.send("aurum:overlay-shown", {
    paired: Boolean(loadDeviceCredential()),
    online: bridge?.state.online ?? false,
    animate: true,
  });
}

function hideOverlayImmediate(): void {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

/** Ask renderer to play exit animation, then hide. */
function hideOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) {
    hideOverlayImmediate();
    return;
  }
  overlayWindow.webContents.send("aurum:overlay-will-hide");
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  // Fallback if renderer never ACKs (reduced-motion / crash).
  overlayHideTimer = setTimeout(() => {
    hideOverlayImmediate();
  }, 320);
}

function registerHotkey(): void {
  voiceHotkey?.dispose();
  voiceHotkey = new VoiceHotkeyController({
    onEnsureOverlayVisible: () => {
      overlayVisibleAtPttPress = Boolean(
        overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible(),
      );
      overlayFocusedAtPttPress = Boolean(
        overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isFocused(),
      );
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        overlayWindow = createOverlayWindow();
      }
      if (!overlayWindow.isVisible()) {
        showOverlay();
      } else if (!overlayWindow.isFocused()) {
        overlayWindow.focus();
        overlayWindow.webContents.send("aurum:overlay-shown", {
          paired: Boolean(loadDeviceCredential()),
          online: bridge?.state.online ?? false,
          animate: false,
        });
      }
    },
    onTapToggle: () => {
      // Tap: open-or-focus text overlay, or hide if it was already focused.
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        overlayWindow = createOverlayWindow();
        showOverlay();
        return;
      }
      if (!overlayVisibleAtPttPress) {
        // Just opened for this tap — keep open for typing.
        overlayWindow.focus();
        overlayWindow.webContents.send("aurum:overlay-focus-input");
        return;
      }
      if (overlayFocusedAtPttPress) {
        hideOverlay();
        return;
      }
      overlayWindow.focus();
      overlayWindow.webContents.send("aurum:overlay-focus-input");
    },
    onStartListening: () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      if (!overlayWindow.isVisible()) showOverlay();
      overlayWindow.webContents.send("aurum:voice-ptt", { phase: "start" });
    },
    onStopAndSubmit: () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayWindow.webContents.send("aurum:voice-ptt", { phase: "stop" });
    },
    onCancelCapture: () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      overlayWindow.webContents.send("aurum:voice-ptt", { phase: "cancel" });
    },
  });

  const ok = globalShortcut.register(DEFAULT_DESKTOP_HOTKEY, () => {
    voiceHotkey?.onAccelerator();
  });
  if (!ok) {
    console.error(`[Aurum] Failed to register hotkey: ${DEFAULT_DESKTOP_HOTKEY}`);
  } else {
    console.log(`[Aurum] Global hotkey registered: ${DEFAULT_DESKTOP_HOTKEY}`);
  }
}

function broadcastUpdaterState(state: UpdaterPublicState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("aurum:updater-state", state);
    }
  }
  rebuildTrayMenu();
}

function createTray(): void {
  const icon = loadBrandNativeImage("tray-32.png", "tray-16.png", "icon.ico");
  tray = new Tray(
    icon.isEmpty()
      ? nativeImage.createFromDataURL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVQ4T2NkYGD4z0AEYBxVSF+FAB+3AfH0b/0YAAAAAElFTkSuQmCC",
        )
      : icon,
  );
  tray.setToolTip(PRODUCT.name);
  rebuildTrayMenu();
  tray.on("double-click", () => showMainWindow());
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const trayUpdate = buildTrayUpdateMenu(desktopUpdater?.getState() ?? null);
  const updateItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: trayUpdate.primaryLabel,
      click: () => {
        if (trayUpdate.primaryAction === "install") {
          desktopUpdater?.install();
        } else {
          void desktopUpdater?.checkForUpdates({ silent: false });
        }
      },
    },
    {
      label: trayUpdate.statusLabel,
      enabled: false,
    },
  ];

  const menu = Menu.buildFromTemplate([
    {
      label: "Open Aurum",
      click: () => showMainWindow(),
    },
    { label: "Show Overlay", click: () => showOverlay() },
    { type: "separator" },
    ...updateItems,
    { type: "separator" },
    {
      label: "Device Status",
      click: () => {
        const paired = Boolean(loadDeviceCredential());
        const online = bridge?.state.online ?? false;
        void dialog.showMessageBox({
          type: "info",
          title: "Aurum Device",
          message: paired
            ? online
              ? "Windows device connected"
              : "Paired — reconnecting…"
            : "Not paired. Open Devices in Aurum to connect.",
        });
      },
    },
    {
      label: "Launch at Startup",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          path: process.execPath,
          // Quiet tray start on login — not a normal manual launch.
          args: item.checked ? [AURUM_AUTOSTART_FLAG] : [],
        });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitAurum();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function quitAurum(): void {
  isQuitting = true;
  desktopUpdater?.stop();
  globalShortcut.unregisterAll();
  bridge?.stop();
  bridge = null;
  overlayChat = null;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  app.quit();
}

function registerIpc(): void {
  ipcMain.handle("aurum:get-info", () => ({
    product: PRODUCT.name,
    version: app.getVersion(),
    phase: 5,
    platform: process.platform,
    webUrl: getAurumWebUrl(),
    paired: Boolean(loadDeviceCredential()),
    online: bridge?.state.online ?? false,
  }));

  ipcMain.handle("aurum:updater-get-state", () => {
    return (
      desktopUpdater?.getState() ?? {
        status: "disabled",
        currentVersion: app.getVersion(),
        latestVersion: null,
        progressPercent: null,
        errorMessage: null,
        enabled: false,
      }
    );
  });

  ipcMain.handle("aurum:updater-check", async () => {
    if (!desktopUpdater) {
      return {
        status: "disabled",
        currentVersion: app.getVersion(),
        latestVersion: null,
        progressPercent: null,
        errorMessage: "Updater not available",
        enabled: false,
      };
    }
    return desktopUpdater.checkForUpdates({ silent: false });
  });

  ipcMain.handle("aurum:updater-install", () => {
    if (!desktopUpdater) return { ok: false, error: "Updater not available" };
    return desktopUpdater.install();
  });

  ipcMain.handle("aurum:hide-overlay", () => {
    hideOverlay();
    return { ok: true };
  });

  ipcMain.handle("aurum:open-external", (_event, raw: unknown) => {
    const parsed = OpenExternalSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid URL" };
    const { url } = parsed.data;
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      return { ok: false, error: "Only http(s) URLs allowed" };
    }
    void shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("aurum:pair-device", async (_event, raw: unknown) => {
    const parsed = z.object({ code: z.string().min(6).max(16) }).safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid code" };

    const configuredUrl = getAurumWebUrl();
    const baseCred: DeviceCredential = loadDeviceCredential() ?? {
      deviceId: "",
      deviceSecret: "",
      deviceName: "",
      webUrl: configuredUrl,
    };
    baseCred.webUrl = configuredUrl;

    bridge?.stop();
    bridge = new DeviceBridge(baseCred, (msg, extra) => logDevice(msg, extra));
    const result = await bridge.pair(parsed.data.code);
    if (!result.ok) {
      bridge = null;
      return result;
    }
    saveDeviceCredential(bridge.getCredential());
    bridge.start();
    return { ok: true, deviceName: bridge.getCredential().deviceName };
  });

  ipcMain.handle("aurum:device-status", () => ({
    paired: Boolean(loadDeviceCredential()),
    online: bridge?.state.online ?? false,
    deviceName: loadDeviceCredential()?.deviceName ?? null,
    roots: bridge?.state.approvedRoots ?? [],
  }));

  ipcMain.handle("aurum:pick-approved-folder", async () => {
    const cred = loadDeviceCredential();
    if (!cred || !bridge) {
      return { ok: false, error: "Device not paired" };
    }
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Approve folder for Aurum",
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: "Cancelled" };
    }
    const folder = result.filePaths[0];
    const label = path.basename(folder);
    const res = await authenticatedDeviceFetch(
      cred,
      `/api/devices/${cred.deviceId}/roots`,
      {
        method: "POST",
        body: JSON.stringify({ label, canonicalPath: folder }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? "Failed to approve folder" };
    }
    const data = (await res.json()) as { root: unknown };
    await bridge.refresh();
    return { ok: true, root: data.root };
  });

  ipcMain.handle("aurum:clear-pairing", () => {
    bridge?.stop();
    bridge = null;
    clearDeviceCredential();
    return { ok: true };
  });

  // Kept for compatibility — no longer opens main window
  ipcMain.handle("aurum:overlay-command", async (_event, raw: unknown) => {
    const parsed = z
      .object({ text: z.string().min(1).max(4000) })
      .safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid command" };
    try {
      const handle = await ensureOverlayChat().start(parsed.data.text);
      return { ok: true, id: handle.id };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Chat failed",
      };
    }
  });

  ipcMain.handle("aurum:overlay-chat-start", async (_event, raw: unknown) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(4000),
        origin: z.enum(["text", "voice"]).optional(),
      })
      .safeParse(raw);
    if (!parsed.success) throw new Error("Invalid command");
    return ensureOverlayChat().start(parsed.data.text, {
      inputMode: parsed.data.origin === "voice" ? "voice" : "text",
    });
  });

  ipcMain.handle("aurum:voice-transcribe", async (_event, raw: unknown) => {
    const parsed = z
      .object({
        bytes: z.any(),
        mimeType: z.string().min(3).max(80),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: "Invalid audio payload", code: "VALIDATION_ERROR" };
    }
    const rawBytes = parsed.data.bytes;
    let bytes: Buffer;
    if (Buffer.isBuffer(rawBytes)) {
      bytes = rawBytes;
    } else if (rawBytes instanceof Uint8Array) {
      bytes = Buffer.from(rawBytes);
    } else if (rawBytes instanceof ArrayBuffer) {
      bytes = Buffer.from(rawBytes);
    } else if (Array.isArray(rawBytes)) {
      bytes = Buffer.from(rawBytes);
    } else {
      return { ok: false, error: "Invalid audio payload", code: "VALIDATION_ERROR" };
    }
    if (bytes.byteLength > 4 * 1024 * 1024) {
      return { ok: false, error: "Audio too large.", code: "too_large" };
    }
    console.info("[aurum:voice:ipc:stt]", {
      bytes: bytes.byteLength,
      mimeType: parsed.data.mimeType,
    });
    return ensureVoiceBridge().transcribe({
      bytes,
      mimeType: parsed.data.mimeType,
    });
  });

  ipcMain.handle("aurum:voice-log", (_event, raw: unknown) => {
    const parsed = z
      .object({
        stage: z.string().min(1).max(80),
        fields: z
          .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
      })
      .safeParse(raw);
    if (!parsed.success) return { ok: false };
    appendVoiceLog(parsed.data.stage, parsed.data.fields ?? {});
    return { ok: true, path: voiceLogFilePath() };
  });

  /** In-memory diagnostic: force synthesize bypass of spoken_mode (PTT path). */
  let voiceDebugBypassSpokenMode = false;

  ipcMain.handle("aurum:voice-debug-flags", (_event, raw: unknown) => {
    const parsed = z
      .object({
        bypassSpokenMode: z.boolean().optional(),
      })
      .safeParse(raw ?? {});
    if (!parsed.success) return { ok: false };
    if (typeof parsed.data.bypassSpokenMode === "boolean") {
      voiceDebugBypassSpokenMode = parsed.data.bypassSpokenMode;
    }
    appendVoiceLog("debug_flags", {
      bypassSpokenMode: voiceDebugBypassSpokenMode,
    });
    return { ok: true, bypassSpokenMode: voiceDebugBypassSpokenMode };
  });

  ipcMain.handle("aurum:voice-synthesize", async (_event, raw: unknown) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(4000),
        voice: z.string().min(1).max(64).optional(),
        bypassSpokenMode: z.boolean().optional(),
        debugDumpWav: z.boolean().optional(),
        purpose: z.string().max(40).optional(),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: "Invalid text", code: "VALIDATION_ERROR" };
    }
    return ensureVoiceBridge().synthesize({
      ...parsed.data,
      bypassSpokenMode:
        parsed.data.bypassSpokenMode === true || voiceDebugBypassSpokenMode,
    });
  });

  ipcMain.handle("aurum:voice-test", async (_event, raw: unknown) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(200).optional(),
        voice: z.string().min(1).max(64).optional(),
      })
      .safeParse(raw ?? {});
    if (!parsed.success) {
      return { ok: false, error: "Invalid test request", code: "VALIDATION_ERROR" };
    }

    let masterVolume: number | null = null;
    let masterMuted: boolean | null = null;
    try {
      const master = await getMasterAudioState();
      masterVolume = master.volume;
      masterMuted = master.muted;
    } catch {
      // safe diagnostic only — ignore if loudness unavailable
    }

    appendVoiceLog("test_voice_start", {
      voice_origin: false,
      bypassSpokenMode: true,
      master_volume: masterVolume,
      master_muted: masterMuted,
    });
    const result = await ensureVoiceBridge().synthesize({
      text: parsed.data.text?.trim() || "Aurum voice test.",
      voice: parsed.data.voice || "Kore",
      bypassSpokenMode: true,
      debugDumpWav: true,
      purpose: "test_voice",
    });
    appendVoiceLog("test_voice_synth_done", {
      ok: result.ok,
      skipped: Boolean(result.skipped),
      synth_status: result.httpStatus ?? null,
      audio_bytes: result.audioBytes ?? 0,
      audio_mime: (result.mimeType ?? "").split(";")[0] || null,
      wav_ok: result.wavInfo?.ok ?? null,
      debug_wav: result.debugWavPath ?? null,
      voice_log: voiceLogFilePath(),
      master_volume: masterVolume,
      master_muted: masterMuted,
    });

    if (!result.ok || !result.audioBase64 || result.skipped) {
      return {
        ...result,
        voiceLogPath: voiceLogFilePath(),
        playbackAttempted: false,
        masterVolume,
        masterMuted,
      };
    }

    // Play through the overlay VoicePlayback path (same as PTT TTS).
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = createOverlayWindow();
    }
    showOverlay();
    const { audioMuted: webContentsMuted } = ensureOverlayAudioReady();
    if (overlayWindow.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        overlayWindow?.webContents.once("did-finish-load", () => resolve());
        setTimeout(() => resolve(), 8_000);
      });
    }
    // Let OverlayApp mount onVoiceTestPlay listener.
    await new Promise((r) => setTimeout(r, 200));

    const playResult = await new Promise<{
      ok: boolean;
      playPromiseResolved?: boolean;
      playErrorName?: string | null;
      playErrorMessage?: string | null;
      audioVolume?: number | null;
      audioMuted?: boolean | null;
      speakingEntered?: boolean | null;
      events?: string | null;
      objectUrlCreated?: boolean | null;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        ipcMain.removeListener("aurum:voice-test-play-result", onResult);
        resolve({
          ok: false,
          playPromiseResolved: false,
          playErrorMessage: "overlay_play_timeout",
        });
      }, 20_000);

      function onResult(
        _e: Electron.IpcMainEvent,
        payload: {
          ok?: boolean;
          playPromiseResolved?: boolean;
          playErrorName?: string | null;
          playErrorMessage?: string | null;
          audioVolume?: number | null;
          audioMuted?: boolean | null;
          speakingEntered?: boolean | null;
          events?: string | null;
          objectUrlCreated?: boolean | null;
        },
      ) {
        clearTimeout(timeout);
        ipcMain.removeListener("aurum:voice-test-play-result", onResult);
        resolve({
          ok: Boolean(payload?.ok),
          playPromiseResolved: payload?.playPromiseResolved,
          playErrorName: payload?.playErrorName ?? null,
          playErrorMessage: payload?.playErrorMessage ?? null,
          audioVolume: payload?.audioVolume ?? null,
          audioMuted: payload?.audioMuted ?? null,
          speakingEntered: payload?.speakingEntered ?? null,
          events: payload?.events ?? null,
          objectUrlCreated: payload?.objectUrlCreated ?? null,
        });
      }

      ipcMain.on("aurum:voice-test-play-result", onResult);
      overlayWindow?.webContents.send("aurum:voice-test-play", {
        audioBase64: result.audioBase64,
        mimeType: result.mimeType || "audio/wav",
        purpose: "test_voice",
      });
    });

    appendVoiceLog("test_voice_playback", {
      playback_attempted: true,
      play_promise_resolved: playResult.playPromiseResolved ?? false,
      play_error_name: playResult.playErrorName ?? null,
      play_error_message: playResult.playErrorMessage ?? null,
      audio_volume: playResult.audioVolume ?? null,
      audio_muted: playResult.audioMuted ?? null,
      speaking_entered: playResult.speakingEntered ?? false,
      object_url_created: playResult.objectUrlCreated ?? null,
      events: playResult.events ?? null,
      webcontents_audio_muted: webContentsMuted,
      master_volume: masterVolume,
      master_muted: masterMuted,
    });

    return {
      ...result,
      ok: result.ok && playResult.ok,
      voiceLogPath: voiceLogFilePath(),
      playbackAttempted: true,
      playPromiseResolved: playResult.playPromiseResolved ?? false,
      playErrorName: playResult.playErrorName ?? null,
      playErrorMessage: playResult.playErrorMessage ?? null,
      speakingEntered: playResult.speakingEntered ?? false,
      objectUrlCreated: playResult.objectUrlCreated ?? false,
      events: playResult.events ?? null,
      webContentsAudioMuted: webContentsMuted,
      masterVolume,
      masterMuted,
    };
  });

  ipcMain.handle("aurum:voice-play-debug-wav", async () => {
    const wavPath = debugWavPath();
    if (!fs.existsSync(wavPath)) {
      return {
        ok: false,
        error: "No debug WAV yet. Run Test Voice first.",
        debugWavPath: wavPath,
      };
    }
    const wav = fs.readFileSync(wavPath);
    const audioBase64 = wav.toString("base64");
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = createOverlayWindow();
    }
    showOverlay();
    const { audioMuted: webContentsMuted } = ensureOverlayAudioReady();
    if (overlayWindow.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        overlayWindow?.webContents.once("did-finish-load", () => resolve());
        setTimeout(() => resolve(), 8_000);
      });
    }
    await new Promise((r) => setTimeout(r, 200));

    appendVoiceLog("debug_wav_play_start", {
      bytes: wav.byteLength,
      webcontents_audio_muted: webContentsMuted,
    });

    const playResult = await new Promise<{
      ok: boolean;
      playPromiseResolved?: boolean;
      playErrorName?: string | null;
      playErrorMessage?: string | null;
      events?: string | null;
      speakingEntered?: boolean | null;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        ipcMain.removeListener("aurum:voice-test-play-result", onResult);
        resolve({
          ok: false,
          playPromiseResolved: false,
          playErrorMessage: "overlay_play_timeout",
        });
      }, 20_000);

      function onResult(
        _e: Electron.IpcMainEvent,
        payload: {
          ok?: boolean;
          playPromiseResolved?: boolean;
          playErrorName?: string | null;
          playErrorMessage?: string | null;
          events?: string | null;
          speakingEntered?: boolean | null;
        },
      ) {
        clearTimeout(timeout);
        ipcMain.removeListener("aurum:voice-test-play-result", onResult);
        resolve({
          ok: Boolean(payload?.ok),
          playPromiseResolved: payload?.playPromiseResolved,
          playErrorName: payload?.playErrorName ?? null,
          playErrorMessage: payload?.playErrorMessage ?? null,
          events: payload?.events ?? null,
          speakingEntered: payload?.speakingEntered ?? null,
        });
      }

      ipcMain.on("aurum:voice-test-play-result", onResult);
      overlayWindow?.webContents.send("aurum:voice-test-play", {
        audioBase64,
        mimeType: "audio/wav",
        purpose: "debug_wav",
      });
    });

    appendVoiceLog("debug_wav_play_done", {
      ok: playResult.ok,
      play_promise_resolved: playResult.playPromiseResolved ?? false,
      play_error_name: playResult.playErrorName ?? null,
      play_error_message: playResult.playErrorMessage ?? null,
      events: playResult.events ?? null,
      webcontents_audio_muted: webContentsMuted,
    });

    return {
      ok: playResult.ok,
      debugWavPath: wavPath,
      audioBytes: wav.byteLength,
      playPromiseResolved: playResult.playPromiseResolved ?? false,
      playErrorName: playResult.playErrorName ?? null,
      playErrorMessage: playResult.playErrorMessage ?? null,
      events: playResult.events ?? null,
      speakingEntered: playResult.speakingEntered ?? false,
      webContentsAudioMuted: webContentsMuted,
      voiceLogPath: voiceLogFilePath(),
    };
  });

  ipcMain.handle("aurum:voice-cancel-ptt", () => {
    voiceHotkey?.cancel();
    return { ok: true };
  });

  ipcMain.handle("aurum:overlay-chat-cancel", (_event, raw: unknown) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
    if (!parsed.success) return { ok: false };
    ensureOverlayChat().cancel(parsed.data.id);
    return { ok: true };
  });

  ipcMain.handle("aurum:overlay-turn-state", () => {
    return ensureOverlayChat().getTurnSnapshot();
  });

  ipcMain.handle("aurum:overlay-turn-patch", (_event, raw: unknown) => {
    const parsed = z
      .object({
        pendingApproval: z
          .object({
            approvalId: z.string().uuid(),
            tool: z.string().min(1).max(120),
            label: z.string().min(1).max(200),
            detail: z.string().max(500),
            confirmVerb: z.string().min(1).max(40),
          })
          .nullable()
          .optional(),
        reply: z.string().max(20_000).optional(),
        warning: z.string().max(500).nullable().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) return { ok: false };
    ensureOverlayChat().patchTurn(parsed.data);
    return { ok: true };
  });

  ipcMain.handle("aurum:overlay-approval-decide", async (_event, raw: unknown) => {
    const parsed = z
      .object({
        approvalId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
      })
      .safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: "Invalid approval request" };
    }
    return ensureOverlayChat().decideApproval(
      parsed.data.approvalId,
      parsed.data.decision,
    );
  });

  ipcMain.handle("aurum:overlay-set-expanded", (_event, raw: unknown) => {
    const parsed = z
      .object({
        mode: z.enum(["idle", "compact", "full"]).optional(),
        expanded: z.boolean().optional(),
        contentHeightPx: z.number().finite().nonnegative().optional(),
      })
      .safeParse(raw);
    if (!parsed.success) return { ok: false };

    if (parsed.data.mode) {
      overlayLayoutMode = parsed.data.mode;
    } else if (typeof parsed.data.expanded === "boolean") {
      // Back-compat: expanded true → compact (legacy), false → idle
      overlayLayoutMode = parsed.data.expanded ? "compact" : "idle";
    }
    if (typeof parsed.data.contentHeightPx === "number") {
      overlayContentHeightPx = parsed.data.contentHeightPx;
    }
    applyOverlayLayout();
    return { ok: true, size: currentOverlaySize() };
  });

  ipcMain.handle("aurum:overlay-hide-complete", () => {
    hideOverlayImmediate();
    return { ok: true };
  });

  ipcMain.handle("aurum:open-in-aurum", (_event, raw: unknown) => {
    const parsed = z
      .object({
        conversationId: z.string().uuid().optional().nullable(),
      })
      .safeParse(raw ?? {});
    const conversationId =
      parsed.success && parsed.data.conversationId
        ? parsed.data.conversationId
        : ensureOverlayChat().getActiveConversationId();
    showMainWindow({
      conversationId,
      hideOverlayFirst: true,
    });
    return { ok: true, conversationId };
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  app.setName(PRODUCT.name);
  if (process.platform === "win32") {
    app.setAppUserModelId("com.aurum.assistant");
  }

  installMediaPermissionHandlers(session.defaultSession);

  desktopUpdater = new DesktopUpdater(app.getVersion(), {
    onStateChange: (state) => broadcastUpdaterState(state),
    beforeQuitAndInstall: () => {
      isQuitting = true;
      desktopUpdater?.stop();
      globalShortcut.unregisterAll();
      voiceHotkey?.dispose();
      voiceHotkey = null;
      bridge?.stop();
      bridge = null;
      overlayChat = null;
      voiceBridge = null;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
      }
    },
  });

  registerIpc();
  createTray();
  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();
  registerHotkey();
  ensureBridge();
  desktopUpdater.start();

  const startupAction = resolveStartupWindowAction({
    argv: process.argv,
    wasOpenedAtLogin: app.getLoginItemSettings().wasOpenedAtLogin,
  });
  if (startupAction === "show-main") {
    showMainWindow();
  }

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  desktopUpdater?.stop();
  globalShortcut.unregisterAll();
  voiceHotkey?.dispose();
  voiceHotkey = null;
  bridge?.stop();
  bridge = null;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  voiceHotkey?.dispose();
  voiceHotkey = null;
  bridge?.stop();
  desktopUpdater?.stop();
});

app.on("window-all-closed", () => {
  // Tray companion stays alive on Windows until Quit
  if (process.platform !== "darwin" && !tray && isQuitting) {
    app.quit();
  }
});
