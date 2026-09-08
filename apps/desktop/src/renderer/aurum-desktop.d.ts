export {};

type UpdaterState = {
  status: string;
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  enabled: boolean;
};

declare global {
  interface Window {
    aurumDesktop?: {
      getInfo: () => Promise<{
        product: string;
        version: string;
        phase: number;
        platform: string;
        webUrl: string;
        paired?: boolean;
        online?: boolean;
      }>;
      hideOverlay: () => Promise<{ ok: boolean }>;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      pairDevice: (
        code: string,
      ) => Promise<{ ok: boolean; error?: string; deviceName?: string }>;
      deviceStatus: () => Promise<{
        paired: boolean;
        online: boolean;
        deviceName: string | null;
        roots: Array<{ id: string; label: string; canonical_path: string }>;
      }>;
      pickApprovedFolder: () => Promise<{
        ok: boolean;
        error?: string;
        root?: unknown;
      }>;
      clearPairing: () => Promise<{ ok: boolean }>;
      submitOverlayCommand: (
        text: string,
      ) => Promise<{ ok: boolean; error?: string }>;
      startOverlayChat?: (
        text: string,
        opts?: { origin?: "text" | "voice" },
      ) => Promise<{ id: string }>;
      cancelOverlayChat?: (id: string) => Promise<{ ok: boolean }>;
      voiceTranscribe?: (opts: {
        bytes: Uint8Array;
        mimeType: string;
      }) => Promise<{
        ok: boolean;
        transcript?: string;
        error?: string;
        code?: string;
        latencyMs?: number;
      }>;
      voiceSynthesize?: (opts: {
        text: string;
        voice?: string;
        bypassSpokenMode?: boolean;
        debugDumpWav?: boolean;
        purpose?: string;
        alreadyPrepared?: boolean;
        skipAddress?: boolean;
        addressAlreadyUsed?: boolean;
        skipSimplification?: boolean;
        origin?: "ptt" | "stream" | "ack" | "tool" | "test_voice" | "final";
        userMessage?: string;
        toolHints?: Array<{
          tool?: string;
          message?: string;
          success?: boolean;
          errorCode?: string;
          data?: Record<string, unknown>;
        }>;
      }) => Promise<{
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
      }>;
      voiceLog?: (opts: {
        stage: string;
        fields?: Record<string, string | number | boolean | null>;
      }) => Promise<{ ok: boolean; path?: string }>;
      voiceTest?: (opts?: {
        text?: string;
        voice?: string;
      }) => Promise<{
        ok: boolean;
        audioBase64?: string;
        mimeType?: string;
        error?: string;
        httpStatus?: number;
        audioBytes?: number;
        debugWavPath?: string | null;
        voiceLogPath?: string;
        wavInfo?: {
          ok?: boolean;
          sampleRate?: number;
          numChannels?: number;
          bitsPerSample?: number;
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
      }>;
      voiceDebugFlags?: (opts?: {
        bypassSpokenMode?: boolean;
      }) => Promise<{ ok: boolean; bypassSpokenMode?: boolean }>;
      onVoiceTestPlay?: (
        callback: (payload: {
          audioBase64: string;
          mimeType: string;
          purpose?: string;
        }) => void,
      ) => () => void;
      voiceTestPlayResult?: (payload: {
        ok: boolean;
        playPromiseResolved?: boolean;
        playErrorName?: string | null;
        playErrorMessage?: string | null;
        audioVolume?: number | null;
        audioMuted?: boolean | null;
        speakingEntered?: boolean;
        events?: string | null;
        objectUrlCreated?: boolean;
      }) => void;
      voicePlayDebugWav?: () => Promise<{
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
      }>;
      voiceCancelPtt?: () => Promise<{ ok: boolean }>;
      onVoicePtt?: (
        callback: (payload: { phase: "start" | "stop" | "cancel" }) => void,
      ) => () => void;
      onOverlayFocusInput?: (callback: () => void) => () => void;
      getOverlayTurnState?: () => Promise<{
        reply?: string;
        warning?: string | null;
        error?: string | null;
        activity?: string | null;
        status?: string;
        pendingApproval?: unknown;
      } | null>;
      patchOverlayTurn?: (patch: Record<string, unknown>) => Promise<unknown>;
      decideOverlayApproval?: (
        approvalId: string,
        decision: "approve" | "reject",
      ) => Promise<{
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
      }>;
      setOverlayExpanded?: (expanded: boolean) => Promise<{ ok: boolean }>;
      setOverlayLayout?: (opts: {
        mode?: "idle" | "compact" | "full";
        contentHeightPx?: number;
        expanded?: boolean;
      }) => Promise<{ ok: boolean; size?: { width: number; height: number } }>;
      notifyOverlayHideComplete?: () => Promise<{ ok: boolean }>;
      openInAurum?: (opts?: {
        conversationId?: string | null;
      }) => Promise<{ ok: boolean; conversationId?: string | null }>;
      getUpdaterState?: () => Promise<UpdaterState>;
      checkForUpdates?: () => Promise<UpdaterState>;
      installUpdate?: () => Promise<{ ok: boolean; error?: string }>;
      onUpdaterState?: (callback: (state: UpdaterState) => void) => () => void;
      onOverlayShown: (
        callback: (state: {
          paired: boolean;
          online: boolean;
          animate?: boolean;
        }) => void,
      ) => () => void;
      onOverlayWillHide?: (callback: () => void) => () => void;
      onOverlayChatEvent?: (
        callback: (payload: {
          id: string;
          event?: unknown;
          done?: boolean;
          error?: string;
        }) => void,
      ) => () => void;
    };
  }
}
