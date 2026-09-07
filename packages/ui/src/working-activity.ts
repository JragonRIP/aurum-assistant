/**
 * Human-readable working status for overlay / Core UI.
 * STATUS only — never chain-of-thought, args, IDs, or payloads.
 */

export type WorkingPhase =
  | "idle"
  | "thinking"
  | "acting"
  | "researching"
  | "responding"
  | "waiting_approval"
  | "waiting_user"
  | "error";

const EXACT_ACTIVITY: Record<string, string> = {
  web_search: "Searching the web...",
  web_read_page: "Reading sources...",
  open_search: "Opening search...",
  open_url: "Opening website...",
  open_application: "Opening app...",
  open_known_application: "Opening app...",
  close_application: "Closing app...",
  close_window: "Closing window...",
  focus_application: "Focusing app...",
  spotify_search_track: "Searching Spotify...",
  spotify_search_tracks: "Searching Spotify...",
  spotify_search_albums: "Searching Spotify...",
  spotify_search_artists: "Searching Spotify...",
  spotify_resolve_playlist: "Finding your playlist...",
  spotify_play_track: "Starting playback...",
  spotify_play_album: "Starting playback...",
  spotify_play_playlist: "Starting playback...",
  spotify_next: "Skipping track...",
  spotify_previous: "Previous track...",
  spotify_pause: "Pausing Spotify...",
  spotify_resume: "Resuming Spotify...",
  spotify_set_volume: "Changing volume...",
  set_system_volume: "Changing volume...",
  mute_system_audio: "Muting audio...",
  unmute_system_audio: "Unmuting audio...",
  find_newest_file: "Searching files...",
  find_largest_file: "Searching files...",
  find_files_by_date: "Searching files...",
  search_files: "Searching files...",
  list_folder: "Searching files...",
  create_task: "Updating tasks...",
  update_task: "Updating tasks...",
  complete_task: "Updating tasks...",
  get_tasks: "Checking tasks...",
  create_note: "Saving note...",
  search_notes: "Searching notes...",
  get_current_time: "Checking the time...",
  capture_screenshot: "Capturing screen...",
  lock_pc: "Locking PC...",
  memory_search: "Searching memory...",
  memory_get: "Loading memory...",
  memory_remember: "Remembering...",
  memory_update: "Updating memory...",
  memory_forget: "Forgetting...",
};

const PREFIX_ACTIVITY: Array<{ prefix: string; label: string }> = [
  { prefix: "spotify_search", label: "Searching Spotify..." },
  { prefix: "spotify_play", label: "Starting playback..." },
  { prefix: "spotify_", label: "Working with Spotify..." },
  { prefix: "web_", label: "Researching..." },
];

/** True when idle prompt / placeholder should be the primary invite. */
export function shouldShowIdlePrompt(opts: {
  streaming: boolean;
  acting: boolean;
  awaitingApproval: boolean;
  awaitingUser: boolean;
  error: boolean;
}): boolean {
  if (opts.awaitingApproval || opts.awaitingUser || opts.error) return false;
  if (opts.streaming || opts.acting) return false;
  return true;
}

export function isResearchTool(tool: string | null | undefined): boolean {
  if (!tool) return false;
  return tool === "web_search" || tool === "web_read_page" || tool.startsWith("web_");
}

/**
 * Map a tool id (+ optional safe display label) to a user-facing activity line.
 * Never returns raw args, execution IDs, or model reasoning.
 */
export function resolveWorkingActivity(opts: {
  tool?: string | null;
  /** Safe label from the server (activityLabel) — may be used if tool unknown. */
  displayLabel?: string | null;
}): string {
  const tool = (opts.tool ?? "").trim();
  if (tool && EXACT_ACTIVITY[tool]) return EXACT_ACTIVITY[tool];
  if (tool) {
    for (const row of PREFIX_ACTIVITY) {
      if (tool.startsWith(row.prefix)) return row.label;
    }
    if (tool.includes("open_application") || tool.includes("open_known")) {
      return "Opening app...";
    }
    if (tool.includes("file") || tool.includes("folder")) {
      return "Searching files...";
    }
    if (tool.includes("calendar") || tool.includes("schedule")) {
      return "Checking calendar...";
    }
  }

  const raw = (opts.displayLabel ?? "").trim();
  if (raw) {
    // Reject anything that looks like internals
    if (
      /[{}\[\]"=]|executionId|tool_call|function_call|https?:\/\//i.test(raw) ||
      raw.length > 80
    ) {
      return "Working on that...";
    }
    return /[.…]$/.test(raw) ? raw : `${raw}...`;
  }

  return "Working on that...";
}

export function defaultPhaseActivity(phase: WorkingPhase): string | null {
  switch (phase) {
    case "thinking":
      return "Looking into that...";
    case "researching":
      return "Searching the web...";
    case "acting":
      return "Working on that...";
    case "responding":
      return null;
    case "waiting_approval":
    case "waiting_user":
    case "error":
    case "idle":
      return null;
    default:
      return null;
  }
}

/** Uppercase presence headline for the overlay status row. */
export function resolveWorkingHeadline(opts: {
  awaitingApproval: boolean;
  awaitingUser: boolean;
  error: boolean;
  researching: boolean;
  acting: boolean;
  streaming: boolean;
  hasReply: boolean;
}): string {
  if (opts.awaitingApproval) return "WAITING FOR APPROVAL";
  if (opts.awaitingUser) return "NEED YOUR INPUT";
  if (opts.error && !opts.streaming) return "ERROR";
  if (opts.researching) return "RESEARCHING";
  if (opts.acting) return "ACTING";
  if (opts.streaming && opts.hasReply) return "RESPONDING";
  if (opts.streaming) return "THINKING";
  return "READY";
}

export function synthesizeWorkingPhase(opts: {
  awaitingApproval: boolean;
  awaitingUser: boolean;
  error: boolean;
  researching: boolean;
  acting: boolean;
  streaming: boolean;
  hasReply: boolean;
}): WorkingPhase {
  if (opts.awaitingApproval) return "waiting_approval";
  if (opts.awaitingUser) return "waiting_user";
  if (opts.error && !opts.streaming) return "error";
  if (opts.researching) return "researching";
  if (opts.acting) return "acting";
  if (opts.streaming && opts.hasReply) return "responding";
  if (opts.streaming) return "thinking";
  return "idle";
}
