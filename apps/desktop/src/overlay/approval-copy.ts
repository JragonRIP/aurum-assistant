/** Overlay-local approval copy helpers (mirrors web decide.ts labels). */

export function approvalPrimaryLabel(
  toolId: string,
  actionLabel?: string | null,
): string {
  const label = (actionLabel ?? "").trim();
  if (label) {
    const cleaned = label.replace(/^Approval required:\s*/i, "");
    return cleaned.endsWith("?") ? cleaned : `${cleaned}?`;
  }
  const map: Record<string, string> = {
    restart_pc: "Restart this PC?",
    shutdown_pc: "Shut down this PC?",
    sleep_pc: "Put this PC to sleep?",
    close_window: "Close this window?",
    close_application: "Close this application?",
    delete_file: "Delete this file?",
    delete_folder: "Delete this folder?",
    terminate_process: "Terminate this process?",
  };
  return map[toolId] ?? "Confirm this action?";
}

export function approvalDetail(toolId: string): string {
  const map: Record<string, string> = {
    restart_pc: "Aurum will restart this computer now.",
    shutdown_pc: "Aurum will shut down this computer now.",
    sleep_pc: "Aurum will put this computer to sleep.",
    close_window: "This may discard unsaved work.",
    close_application: "This may discard unsaved work.",
    delete_file: "This will permanently remove the file.",
    delete_folder: "This will permanently remove the folder.",
    terminate_process: "This will force-quit the process.",
  };
  return map[toolId] ?? "This action needs your confirmation before it runs.";
}

export function approvalConfirmVerb(toolId: string): string {
  const map: Record<string, string> = {
    restart_pc: "Restart",
    shutdown_pc: "Shut down",
    sleep_pc: "Sleep",
    close_window: "Close",
    close_application: "Close",
    delete_file: "Delete",
    delete_folder: "Delete",
    terminate_process: "Terminate",
  };
  return map[toolId] ?? "Approve";
}
