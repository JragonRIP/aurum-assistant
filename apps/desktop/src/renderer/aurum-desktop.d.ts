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
      startOverlayChat?: (text: string) => Promise<{ id: string }>;
      cancelOverlayChat?: (id: string) => Promise<{ ok: boolean }>;
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
