import { contextBridge, ipcRenderer } from "electron";

/**
 * Secure preload — narrow typed API only.
 * Never expose fs, child_process, credentials, or raw IPC.
 */

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

  startOverlayChat: (
    text: string,
  ): Promise<{ id: string }> =>
    ipcRenderer.invoke("aurum:overlay-chat-start", { text }),

  cancelOverlayChat: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:overlay-chat-cancel", { id }),

  setOverlayExpanded: (expanded: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:overlay-set-expanded", { expanded }),

  openInAurum: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:open-in-aurum"),

  onOverlayShown: (
    callback: (state: { paired: boolean; online: boolean }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: { paired: boolean; online: boolean },
    ): void => {
      callback(state);
    };
    ipcRenderer.on("aurum:overlay-shown", listener);
    return () => {
      ipcRenderer.removeListener("aurum:overlay-shown", listener);
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
