/**
 * Pure version helpers for the desktop updater (no Electron imports).
 */

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "update_available"
  | "up_to_date"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error"
  | "disabled";

export type UpdaterPublicState = {
  status: UpdaterStatus;
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
  enabled: boolean;
};

export function createInitialUpdaterState(
  currentVersion: string,
  enabled: boolean,
): UpdaterPublicState {
  return {
    status: enabled ? "idle" : "disabled",
    currentVersion,
    latestVersion: null,
    progressPercent: null,
    errorMessage: null,
    enabled,
  };
}

/** Parse "1.2.3" / "v1.2.3" into [major, minor, patch]. Invalid → null. */
export function parseSemver(raw: string): [number, number, number] | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(cleaned);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True only when latest is strictly newer than current. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

export function updaterStatusLabel(state: UpdaterPublicState): string {
  switch (state.status) {
    case "disabled":
      return "Updates unavailable in development";
    case "checking":
      return "Checking for updates…";
    case "update_available":
      return state.latestVersion
        ? `Aurum update available · ${state.latestVersion}`
        : "Aurum update available";
    case "up_to_date":
      return "Aurum is up to date";
    case "downloading":
      return state.progressPercent != null
        ? `Downloading update · ${Math.round(state.progressPercent)}%`
        : "Downloading update";
    case "downloaded":
      return state.latestVersion
        ? `Update ready · ${state.latestVersion}`
        : "Update ready";
    case "installing":
      return "Installing update…";
    case "error":
      return state.errorMessage
        ? `Update error · ${state.errorMessage}`
        : "Update error";
    case "idle":
    default:
      return "No update check yet";
  }
}
