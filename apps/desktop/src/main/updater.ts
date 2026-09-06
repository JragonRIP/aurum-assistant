/**
 * DesktopUpdater — typed electron-updater wrapper (main process only).
 * Renderer never sets update URLs or release locations.
 */
import { app, dialog } from "electron";
import {
  createInitialUpdaterState,
  isNewerVersion,
  updaterStatusLabel,
  type UpdaterPublicState,
  type UpdaterStatus,
} from "./updater-state";

const CHECK_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 hours
const STARTUP_DELAY_MS = 8_000;

export type DesktopUpdaterHooks = {
  onStateChange?: (state: UpdaterPublicState) => void;
  /** Called before quitAndInstall so the host can unregister shortcuts / stop bridge */
  beforeQuitAndInstall?: () => void;
};

export class DesktopUpdater {
  private state: UpdaterPublicState;
  private interval: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private autoUpdater: import("electron-updater").AppUpdater | null = null;
  private promptOpen = false;
  private downloadStarted = false;

  constructor(
    private readonly currentVersion: string,
    private readonly hooks: DesktopUpdaterHooks = {},
  ) {
    const enabled = app.isPackaged;
    this.state = createInitialUpdaterState(currentVersion, enabled);
  }

  getState(): UpdaterPublicState {
    return { ...this.state };
  }

  getStatusLabel(): string {
    return updaterStatusLabel(this.state);
  }

  /** Start background checks (packaged only). Non-blocking. */
  start(): void {
    if (!this.state.enabled) {
      this.log("updater disabled (not packaged)");
      return;
    }

    try {
      // Lazy require so tests / unpackaged loads do not need electron-updater wiring
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
      this.autoUpdater = autoUpdater;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      // Aurum is currently unsigned. electron-updater refuses unsigned NSIS
      // updates unless this is false. Re-enable when Authenticode signing lands.
      // This does NOT bypass Windows SmartScreen.
      (
        autoUpdater as typeof autoUpdater & {
          verifyUpdateCodeSignature?: boolean;
        }
      ).verifyUpdateCodeSignature = false;
      autoUpdater.logger = {
        info: (m: string) => this.log(m),
        warn: (m: string) => this.log(`warn: ${m}`),
        error: (m: string) => this.log(`error: ${m}`),
        debug: () => undefined,
      };

      autoUpdater.on("checking-for-update", () => {
        this.setStatus("checking");
      });
      autoUpdater.on("update-available", (info) => {
        const latest = info.version ?? null;
        if (latest && !isNewerVersion(latest, this.currentVersion)) {
          this.patch({
            status: "up_to_date",
            latestVersion: latest,
            errorMessage: null,
          });
          return;
        }
        this.downloadStarted = true;
        this.patch({
          status: "update_available",
          latestVersion: latest,
          errorMessage: null,
        });
      });
      autoUpdater.on("update-not-available", (info) => {
        this.patch({
          status: "up_to_date",
          latestVersion: info.version ?? this.currentVersion,
          errorMessage: null,
          progressPercent: null,
        });
      });
      autoUpdater.on("download-progress", (p) => {
        this.patch({
          status: "downloading",
          progressPercent: p.percent ?? 0,
          errorMessage: null,
        });
      });
      autoUpdater.on("update-downloaded", (info) => {
        this.patch({
          status: "downloaded",
          latestVersion: info.version ?? this.state.latestVersion,
          progressPercent: 100,
          errorMessage: null,
        });
        void this.promptInstall();
      });
      autoUpdater.on("error", (err) => {
        const message =
          err instanceof Error
            ? err.message.slice(0, 200)
            : "Update check failed";
        this.log(`updater error: ${message}`);
        this.patch({
          status: "error",
          errorMessage: message,
          progressPercent: null,
        });
      });
    } catch (err) {
      this.log(
        `failed to init updater: ${err instanceof Error ? err.message : "unknown"}`,
      );
      this.patch({
        status: "error",
        errorMessage: "Updater failed to initialize",
        enabled: false,
      });
      return;
    }

    this.startupTimer = setTimeout(() => {
      void this.checkForUpdates({ silent: true });
    }, STARTUP_DELAY_MS);

    this.interval = setInterval(() => {
      void this.checkForUpdates({ silent: true });
    }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.interval) clearInterval(this.interval);
    this.startupTimer = null;
    this.interval = null;
  }

  async checkForUpdates(opts?: {
    silent?: boolean;
  }): Promise<UpdaterPublicState> {
    if (!this.state.enabled || !this.autoUpdater) {
      return this.getState();
    }
    if (
      this.state.status === "checking" ||
      this.state.status === "downloading" ||
      this.state.status === "installing"
    ) {
      return this.getState();
    }

    try {
      this.setStatus("checking");
      const result = await this.autoUpdater.checkForUpdates();
      // Handlers usually advance status; if nothing fired, reset from checking.
      if (!result && this.getState().status === "checking") {
        this.setStatus("idle");
      }
      return this.getState();
    } catch (err) {
      const message =
        err instanceof Error ? err.message.slice(0, 200) : "Update check failed";
      this.log(`checkForUpdates failed: ${message}`);
      this.patch({
        status: "error",
        errorMessage: message,
      });
      if (!opts?.silent) {
        // Manual check only — one dialog, never spam
        void dialog.showMessageBox({
          type: "warning",
          title: "Aurum Console Update",
          message: "Could not check for updates.",
          detail: message,
          buttons: ["OK"],
        });
      }
      return this.getState();
    }
  }

  /** Install a downloaded update after cleanup. */
  install(): { ok: boolean; error?: string } {
    if (!this.state.enabled || !this.autoUpdater) {
      return { ok: false, error: "Updater disabled" };
    }
    if (this.state.status !== "downloaded") {
      return { ok: false, error: "No update ready to install" };
    }
    try {
      this.setStatus("installing");
      this.hooks.beforeQuitAndInstall?.();
      // isSilent=false, isForceRunAfter=true
      this.autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof Error ? err.message.slice(0, 200) : "Install failed";
      this.patch({ status: "error", errorMessage: message });
      return { ok: false, error: message };
    }
  }

  private async promptInstall(): Promise<void> {
    if (this.promptOpen) return;
    this.promptOpen = true;
    try {
      const version = this.state.latestVersion ?? "a new version";
      const result = await dialog.showMessageBox({
        type: "info",
        title: "Aurum Console Update",
        message: `Aurum Console ${version} is ready to install.`,
        detail:
          "Restart Aurum Console to apply the update. Your device pairing and settings are preserved.",
        buttons: ["Restart & Update", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response === 0) {
        this.install();
      }
    } catch (err) {
      this.log(
        `prompt failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      this.promptOpen = false;
    }
  }

  private setStatus(status: UpdaterStatus): void {
    this.patch({ status });
  }

  private patch(partial: Partial<UpdaterPublicState>): void {
    this.state = { ...this.state, ...partial };
    this.hooks.onStateChange?.(this.getState());
  }

  private log(message: string): void {
    console.info("[aurum:updater]", message);
  }
}
