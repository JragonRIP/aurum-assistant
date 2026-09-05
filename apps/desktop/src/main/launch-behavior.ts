/**
 * Pure launch / window routing policy (no Electron imports).
 * Manual app launch → main window; Ctrl+Space → overlay only.
 */

/** Passed via login-item args so autostart can stay tray-quiet. */
export const AURUM_AUTOSTART_FLAG = "--aurum-autostart";

export type StartupWindowAction = "show-main" | "tray-only";
export type SecondInstanceAction = "show-main";
export type TrayWindowAction = "show-main" | "show-overlay";

/** True when this process was started as a Windows/macOS login item. */
export function isAutostartLaunch(
  argv: readonly string[],
  wasOpenedAtLogin?: boolean,
): boolean {
  if (wasOpenedAtLogin === true) return true;
  return argv.some(
    (arg) => arg === AURUM_AUTOSTART_FLAG || arg === "--hidden",
  );
}

/**
 * First process start: manual launch opens the full app;
 * login-item / autostart stays in the tray.
 */
export function resolveStartupWindowAction(opts: {
  argv: readonly string[];
  wasOpenedAtLogin?: boolean;
}): StartupWindowAction {
  return isAutostartLaunch(opts.argv, opts.wasOpenedAtLogin)
    ? "tray-only"
    : "show-main";
}

/** Second Aurum.exe / Start Menu launch while running → full app, never overlay. */
export function resolveSecondInstanceAction(): SecondInstanceAction {
  return "show-main";
}

export function resolveTrayOpenAurumAction(): TrayWindowAction {
  return "show-main";
}

export function resolveTrayShowOverlayAction(): TrayWindowAction {
  return "show-overlay";
}

/** Ctrl+Space must never imply opening the main application. */
export function resolveHotkeyAction(): "show-overlay" {
  return "show-overlay";
}

/** Main BrowserWindow loads Aurum web (Core home). */
export function mainWindowEntryUrl(webOrigin: string): string {
  const base = webOrigin.replace(/\/$/, "");
  return `${base}/core`;
}

/** Narrow updater IPC channel names — must stay closed to arbitrary URLs. */
export const UPDATER_IPC_CHANNELS = [
  "aurum:updater-get-state",
  "aurum:updater-check",
  "aurum:updater-install",
] as const;
