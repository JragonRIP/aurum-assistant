import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from "electron";
import path from "node:path";
import { z } from "zod";
import { DeviceBridge } from "./bridge";
import { getAurumWebUrl, loadDesktopEnv } from "./config";
import {
  clearDeviceCredential,
  loadDeviceCredential,
  saveDeviceCredential,
  type DeviceCredential,
} from "./credentials";
import { OverlayChatBridge } from "./overlay-chat";
import {
  AURUM_AUTOSTART_FLAG,
  mainWindowEntryUrl,
  resolveSecondInstanceAction,
  resolveStartupWindowAction,
} from "./launch-behavior";
import { DesktopUpdater } from "./updater";
import type { UpdaterPublicState } from "./updater-state";
import { buildTrayUpdateMenu } from "./updater-tray";

/**
 * Aurum Desktop — Phase 4.3 companion (device bridge + auto-updater).
 * Manual launch → full main window; Ctrl+Space → overlay only.
 */

loadDesktopEnv();

const PRODUCT = {
  name: "Aurum",
} as const;

const DEFAULT_DESKTOP_HOTKEY = "CommandOrControl+Space";

const OVERLAY_IDLE = { width: 700, height: 140 } as const;
const OVERLAY_EXPANDED = { width: 700, height: 420 } as const;
const BOTTOM_GAP_PX = 36;

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bridge: DeviceBridge | null = null;
let overlayChat: OverlayChatBridge | null = null;
let overlayExpanded = false;
let isQuitting = false;
let desktopUpdater: DesktopUpdater | null = null;

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

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: PRODUCT.name,
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
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function activeDisplay() {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point);
}

function positionOverlay(
  win: BrowserWindow,
  size: { width: number; height: number },
): void {
  const display = activeDisplay();
  const { workArea } = display;
  const width = Math.min(size.width, workArea.width - 24);
  const height = Math.min(size.height, Math.floor(workArea.height * 0.55));
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + workArea.height - height - BOTTOM_GAP_PX);
  win.setBounds({ x, y, width, height });
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: OVERLAY_IDLE.width,
    height: OVERLAY_IDLE.height,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    focusable: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  positionOverlay(win, OVERLAY_IDLE);
  void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  return win;
}

function showOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
  }
  positionOverlay(
    overlayWindow,
    overlayExpanded ? OVERLAY_EXPANDED : OVERLAY_IDLE,
  );
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.webContents.send("aurum:overlay-shown", {
    paired: Boolean(loadDeviceCredential()),
    online: bridge?.state.online ?? false,
  });
}

function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

function registerHotkey(): void {
  const ok = globalShortcut.register(DEFAULT_DESKTOP_HOTKEY, () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = createOverlayWindow();
      showOverlay();
      return;
    }
    if (!overlayWindow.isVisible()) {
      showOverlay();
      return;
    }
    if (!overlayWindow.isFocused()) {
      overlayWindow.focus();
      overlayWindow.webContents.send("aurum:overlay-shown", {
        paired: Boolean(loadDeviceCredential()),
        online: bridge?.state.online ?? false,
      });
      return;
    }
    hideOverlay();
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
  const icon = nativeImage.createEmpty();
  tray = new Tray(
    icon.isEmpty()
      ? nativeImage.createFromDataURL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFUlEQVQ4T2NkYGD4z0AEYBxVSF+FAB+3AfH0b/0YAAAAAElFTkSuQmCC",
        )
      : icon,
  );
  tray.setToolTip("Aurum");
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
    phase: 4.3,
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
    const res = await fetch(
      `${getAurumWebUrl()}/api/devices/${cred.deviceId}/roots`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cred.deviceId}.${cred.deviceSecret}`,
          "Content-Type": "application/json",
        },
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
      .object({ text: z.string().min(1).max(4000) })
      .safeParse(raw);
    if (!parsed.success) throw new Error("Invalid command");
    return ensureOverlayChat().start(parsed.data.text);
  });

  ipcMain.handle("aurum:overlay-chat-cancel", (_event, raw: unknown) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(raw);
    if (!parsed.success) return { ok: false };
    ensureOverlayChat().cancel(parsed.data.id);
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
    const parsed = z.object({ expanded: z.boolean() }).safeParse(raw);
    if (!parsed.success) return { ok: false };
    overlayExpanded = parsed.data.expanded;
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      positionOverlay(
        overlayWindow,
        overlayExpanded ? OVERLAY_EXPANDED : OVERLAY_IDLE,
      );
    }
    return { ok: true };
  });

  ipcMain.handle("aurum:open-in-aurum", () => {
    showMainWindow();
    return { ok: true };
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  desktopUpdater = new DesktopUpdater(app.getVersion(), {
    onStateChange: (state) => broadcastUpdaterState(state),
    beforeQuitAndInstall: () => {
      isQuitting = true;
      desktopUpdater?.stop();
      globalShortcut.unregisterAll();
      bridge?.stop();
      bridge = null;
      overlayChat = null;
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
  bridge?.stop();
  bridge = null;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  bridge?.stop();
  desktopUpdater?.stop();
});

app.on("window-all-closed", () => {
  // Tray companion stays alive on Windows until Quit
  if (process.platform !== "darwin" && !tray && isQuitting) {
    app.quit();
  }
});
