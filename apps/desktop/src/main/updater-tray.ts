/**
 * Pure tray labels for updater menu items (testable without Electron Tray).
 */
import { updaterStatusLabel, type UpdaterPublicState } from "./updater-state";

export type TrayUpdatePrimaryAction = "check" | "install";

export type TrayUpdateMenuModel = {
  primaryLabel: string;
  primaryAction: TrayUpdatePrimaryAction;
  statusLabel: string;
};

export function buildTrayUpdateMenu(
  state: UpdaterPublicState | null,
): TrayUpdateMenuModel {
  if (!state) {
    return {
      primaryLabel: "Check for Updates",
      primaryAction: "check",
      statusLabel: "Update: unavailable",
    };
  }

  if (state.status === "downloaded") {
    return {
      primaryLabel: "Restart to Update Aurum",
      primaryAction: "install",
      statusLabel: `Update: ${updaterStatusLabel(state)}`,
    };
  }

  return {
    primaryLabel: "Check for Updates",
    primaryAction: "check",
    statusLabel: `Update: ${updaterStatusLabel(state)}`,
  };
}
