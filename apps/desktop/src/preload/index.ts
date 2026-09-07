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

  startOverlayChat: (
    text: string,
    opts?: { origin?: "text" | "voice" },
  ): Promise<{ id: string }> =>
    ipcRenderer.invoke("aurum:overlay-chat-start", {
      text,
      origin: opts?.origin,
    }),

  cancelOverlayChat: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:overlay-chat-cancel", { id }),

  getOverlayTurnState: (): Promise<{
    executionId: string | null;
    conversationId: string | null;
    status:
      | "IDLE"
      | "RUNNING"
      | "WAITING_FOR_APPROVAL"
      | "WAITING_FOR_USER"
      | "COMPLETED"
      | "FAILED"
      | "CANCELLED";
    activity: string | null;
    reply: string;
    warning: string | null;
    error: string | null;
    pendingApproval: {
      approvalId: string;
      tool: string;
      label: string;
      detail: string;
      confirmVerb: string;
    } | null;
    inputMode: "text" | "voice" | null;
    updatedAt: number;
  }> => ipcRenderer.invoke("aurum:overlay-turn-state"),

  patchOverlayTurn: (patch: {
    pendingApproval?: {
      approvalId: string;
      tool: string;
      label: string;
      detail: string;
      confirmVerb: string;
    } | null;
    reply?: string;
    warning?: string | null;
  }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:overlay-turn-patch", patch),

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

  onVoicePtt: (
    callback: (payload: { phase: "start" | "stop" | "cancel" }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { phase: "start" | "stop" | "cancel" },
    ): void => {
      callback(payload);
    };
    ipcRenderer.on("aurum:voice-ptt", listener);
    return () => {
      ipcRenderer.removeListener("aurum:voice-ptt", listener);
    };
  },

  onVoiceTestPlay: (
    callback: (payload: {
      audioBase64: string;
      mimeType: string;
      purpose?: string;
    }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { audioBase64: string; mimeType: string; purpose?: string },
    ): void => {
      callback(payload);
    };
    ipcRenderer.on("aurum:voice-test-play", listener);
    return () => {
      ipcRenderer.removeListener("aurum:voice-test-play", listener);
    };
  },

  voiceTestPlayResult: (payload: {
    ok: boolean;
    playPromiseResolved?: boolean;
    playErrorName?: string | null;
    playErrorMessage?: string | null;
    audioVolume?: number | null;
    audioMuted?: boolean | null;
    speakingEntered?: boolean;
    events?: string | null;
    objectUrlCreated?: boolean;
  }): void => {
    ipcRenderer.send("aurum:voice-test-play-result", payload);
  },

  onOverlayFocusInput: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback();
    };
    ipcRenderer.on("aurum:overlay-focus-input", listener);
    return () => {
      ipcRenderer.removeListener("aurum:overlay-focus-input", listener);
    };
  },

  voiceTranscribe: (opts: {
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{
    ok: boolean;
    transcript?: string;
    error?: string;
    code?: string;
    latencyMs?: number;
  }> => ipcRenderer.invoke("aurum:voice-transcribe", opts),

  voiceSynthesize: (opts: {
    text: string;
    voice?: string;
    bypassSpokenMode?: boolean;
    debugDumpWav?: boolean;
    purpose?: string;
  }): Promise<{
    ok: boolean;
    audioBase64?: string;
    mimeType?: string;
    speechText?: string;
    error?: string;
    code?: string;
    latencyMs?: number;
    skipped?: boolean;
    spokenMode?: string | null;
    voiceEnabled?: boolean | null;
    debugWavPath?: string | null;
    audioBytes?: number;
    httpStatus?: number;
    wavInfo?: {
      ok: boolean;
      sampleRate?: number;
      numChannels?: number;
      bitsPerSample?: number;
      nonzeroSamples?: number;
      durationMsApprox?: number;
      error?: string;
    } | null;
  }> => ipcRenderer.invoke("aurum:voice-synthesize", opts),

  voiceLog: (opts: {
    stage: string;
    fields?: Record<string, string | number | boolean | null>;
  }): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke("aurum:voice-log", opts),

  voiceTest: (opts?: {
    text?: string;
    voice?: string;
  }): Promise<{
    ok: boolean;
    audioBase64?: string;
    mimeType?: string;
    speechText?: string;
    error?: string;
    code?: string;
    skipped?: boolean;
    debugWavPath?: string | null;
    audioBytes?: number;
    httpStatus?: number;
    voiceLogPath?: string;
    wavInfo?: {
      ok: boolean;
      sampleRate?: number;
      numChannels?: number;
      bitsPerSample?: number;
      nonzeroSamples?: number;
    } | null;
    playbackAttempted?: boolean;
    playPromiseResolved?: boolean;
    playErrorName?: string | null;
    playErrorMessage?: string | null;
    speakingEntered?: boolean;
    objectUrlCreated?: boolean;
    events?: string | null;
    webContentsAudioMuted?: boolean | null;
    masterVolume?: number | null;
    masterMuted?: boolean | null;
  }> => ipcRenderer.invoke("aurum:voice-test", opts ?? {}),

  voicePlayDebugWav: (): Promise<{
    ok: boolean;
    error?: string;
    debugWavPath?: string;
    audioBytes?: number;
    playPromiseResolved?: boolean;
    playErrorName?: string | null;
    playErrorMessage?: string | null;
    events?: string | null;
    speakingEntered?: boolean;
    webContentsAudioMuted?: boolean | null;
    voiceLogPath?: string;
  }> => ipcRenderer.invoke("aurum:voice-play-debug-wav"),

  voiceDebugFlags: (opts?: {
    bypassSpokenMode?: boolean;
  }): Promise<{ ok: boolean; bypassSpokenMode?: boolean }> =>
    ipcRenderer.invoke("aurum:voice-debug-flags", opts ?? {}),

  voiceCancelPtt: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("aurum:voice-cancel-ptt"),

  localTtsSettingsGet: (): Promise<{
    ok: boolean;
    settings?: {
      speechEngine: "local" | "gemini" | "auto";
      kokoroVoice: string;
      speed: number;
      allowGeminiFallback: boolean;
    };
  }> => ipcRenderer.invoke("aurum:local-tts-settings-get"),

  localTtsSettingsSet: (
    patch: Partial<{
      speechEngine: "local" | "gemini" | "auto";
      kokoroVoice: string;
      speed: number;
      allowGeminiFallback: boolean;
    }>,
  ): Promise<{
    ok: boolean;
    settings?: {
      speechEngine: "local" | "gemini" | "auto";
      kokoroVoice: string;
      speed: number;
      allowGeminiFallback: boolean;
    };
  }> => ipcRenderer.invoke("aurum:local-tts-settings-set", patch),

  voiceEngineStatus: (): Promise<{
    ok: boolean;
    engine?: {
      status: string;
      detail?: string | null;
      modelLoadMs?: number | null;
    };
    health?: {
      status: string;
      ready: boolean;
      detail?: string | null;
    };
    voices?: Array<{ id: string; label: string; lang?: string; gender?: string }>;
    settings?: {
      speechEngine: "local" | "gemini" | "auto";
      kokoroVoice: string;
      speed: number;
      allowGeminiFallback: boolean;
    };
  }> => ipcRenderer.invoke("aurum:voice-engine-status"),

  voiceEngineRestart: (): Promise<{
    ok: boolean;
    engine?: { status: string; detail?: string | null };
  }> => ipcRenderer.invoke("aurum:voice-engine-restart"),
};

contextBridge.exposeInMainWorld("aurumDesktop", aurumDesktop);

export type AurumDesktopApi = typeof aurumDesktop;
