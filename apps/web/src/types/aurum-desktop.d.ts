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
      getUpdaterState?: () => Promise<UpdaterState>;
      checkForUpdates?: () => Promise<UpdaterState>;
      installUpdate?: () => Promise<{ ok: boolean; error?: string }>;
      onUpdaterState?: (callback: (state: UpdaterState) => void) => () => void;
    };
  }
}
