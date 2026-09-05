export {};

declare global {
  interface Window {
    aurumDesktop: {
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
      onOverlayShown: (
        callback: (state: { paired: boolean; online: boolean }) => void,
      ) => () => void;
    };
  }
}
