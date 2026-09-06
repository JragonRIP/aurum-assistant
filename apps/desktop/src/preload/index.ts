import { contextBridge, ipcRenderer } from "electron";

/**
 * Secure preload — narrow typed API only.
 * Never expose fs, child_process, credentials, or raw IPC.
 */

type UpdaterState = {
  status: string;
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  enabled: boolean;
};

const aurumDesktop = {
  getInfo: (): Promise<{
    product: string;
    version: string;
    phase: number;
    platform: string;
    webUrl: string;
    paired?: boolean;
    online?: boolean;
  }> => ipcRenderer.invoke("aurum:get-info"),

  hideOverlay: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:hide-overlay"),

  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("aurum:open-external", { url }),

  pairDevice: (
    code: string,
  ): Promise<{ ok: boolean; error?: string; deviceName?: string }> =>
    ipcRenderer.invoke("aurum:pair-device", { code }),

  deviceStatus: (): Promise<{
    paired: boolean;
    online: boolean;
    deviceName: string | null;
    roots: Array<{ id: string; label: string; canonical_path: string }>;
  }> => ipcRenderer.invoke("aurum:device-status"),

  pickApprovedFolder: (): Promise<{
    ok: boolean;
    error?: string;
    root?: unknown;
  }> => ipcRenderer.invoke("aurum:pick-approved-folder"),

  clearPairing: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:clear-pairing"),

  /** @deprecated Phase 4 redirect — use startOverlayChat */
  submitOverlayCommand: (
    text: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("aurum:overlay-command", { text }),

  startOverlayChat: (text: string): Promise<{ id: string }> =>
    ipcRenderer.invoke("aurum:overlay-chat-start", { text }),

  cancelOverlayChat: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:overlay-chat-cancel", { id }),

  decideOverlayApproval: (
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<{
    ok: boolean;
    status?: "APPROVED" | "REJECTED";
    alreadyResolved?: boolean;
    error?: string;
    code?: string;
    result?: {
      success?: boolean;
      message?: string;
      error?: { code?: string; message?: string } | null;
      activityLabel?: string;
    };
  }> =>
    ipcRenderer.invoke("aurum:overlay-approval-decide", {
      approvalId,
      decision,
    }),

  setOverlayExpanded: (expanded: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:overlay-set-expanded", { expanded }),

  setOverlayLayout: (opts: {
    mode?: "idle" | "compact" | "full";
    contentHeightPx?: number;
    expanded?: boolean;
  }): Promise<{ ok: boolean; size?: { width: number; height: number } }> =>
    ipcRenderer.invoke("aurum:overlay-set-expanded", opts),

  notifyOverlayHideComplete: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:overlay-hide-complete"),

  openInAurum: (opts?: {
    conversationId?: string | null;
  }): Promise<{ ok: boolean; conversationId?: string | null }> =>
    ipcRenderer.invoke("aurum:open-in-aurum", opts ?? {}),

  getUpdaterState: (): Promise<UpdaterState> =>
    ipcRenderer.invoke("aurum:updater-get-state"),

  checkForUpdates: (): Promise<UpdaterState> =>
    ipcRenderer.invoke("aurum:updater-check"),

  installUpdate: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("aurum:updater-install"),

  onUpdaterState: (callback: (state: UpdaterState) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: UpdaterState,
    ): void => {
      callback(state);
    };
    ipcRenderer.on("aurum:updater-state", listener);
    return () => {
      ipcRenderer.removeListener("aurum:updater-state", listener);
    };
  },

  onOverlayShown: (
    callback: (state: {
      paired: boolean;
      online: boolean;
      animate?: boolean;
    }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: { paired: boolean; online: boolean; animate?: boolean },
    ): void => {
      callback(state);
    };
    ipcRenderer.on("aurum:overlay-shown", listener);
    return () => {
      ipcRenderer.removeListener("aurum:overlay-shown", listener);
    };
  },

  onOverlayWillHide: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback();
    };
    ipcRenderer.on("aurum:overlay-will-hide", listener);
    return () => {
      ipcRenderer.removeListener("aurum:overlay-will-hide", listener);
    };
  },

  onOverlayChatEvent: (
    callback: (payload: {
      id: string;
      event?: unknown;
      done?: boolean;
      error?: string;
    }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        id: string;
        event?: unknown;
        done?: boolean;
        error?: string;
      },
    ): void => {
      callback(payload);
    };
    ipcRenderer.on("aurum:overlay-chat-event", listener);
    return () => {
      ipcRenderer.removeListener("aurum:overlay-chat-event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("aurumDesktop", aurumDesktop);

export type AurumDesktopApi = typeof aurumDesktop;
