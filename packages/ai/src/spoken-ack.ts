/**
 * Pre-action spoken acknowledgements — deterministic, no extra model call.
 * Never claims the action already succeeded.
 */

export type SpokenAckKind =
  | "open_app"
  | "close_app"
  | "search"
  | "navigate"
  | "file"
  | "calendar_write"
  | "playlist_write"
  | "multi"
  | "generic_slow";

const INSTANT_TOOLS = new Set([
  "spotify_pause",
  "spotify_resume",
  "spotify_next",
  "spotify_previous",
  "spotify_set_volume",
  "spotify_get_playback_state",
  "get_current_time",
  "set_system_volume",
  "mute_system_audio",
  "unmute_system_audio",
]);

const ACK_BY_TOOL: Array<{ test: (tool: string) => boolean; kind: SpokenAckKind }> =
  [
    {
      test: (t) => t === "open_application",
      kind: "open_app",
    },
    {
      test: (t) => t === "close_application" || t === "close_window",
      kind: "close_app",
    },
    {
      test: (t) =>
        t === "web_search" ||
        t === "web_image_search" ||
        t === "web_read_page",
      kind: "search",
    },
    {
      test: (t) => t === "open_url" || t === "open_search",
      kind: "navigate",
    },
    {
      test: (t) =>
        t.includes("file") ||
        t.includes("download") ||
        t.includes("folder") ||
        t === "write_file" ||
        t === "read_file",
      kind: "file",
    },
    {
      test: (t) =>
        (t.includes("calendar") || t.includes("event")) &&
        /(create|update|delete|add|write|schedule|move|insert)/.test(t),
      kind: "calendar_write",
    },
    {
      test: (t) =>
        t.includes("playlist") ||
        t === "spotify_add_tracks_to_playlist" ||
        t === "spotify_add_playlist_items" ||
        t === "spotify_create_playlist" ||
        t === "spotify_remove_playlist_items",
      kind: "playlist_write",
    },
  ];

export function isInstantSpokenAction(tool?: string | null): boolean {
  if (!tool) return false;
  return INSTANT_TOOLS.has(tool);
}

const NO_PREACK = new Set([
  "spotify_play_track",
  "spotify_play_playlist",
  "spotify_play",
]);

const MULTI_ACTION_VERBS =
  /\b(open|close|play|search|find|send|save|add|download|navigate|update)\b/gi;

export function looksLikeMultiSpokenAction(userMessage?: string | null): boolean {
  if (!userMessage) return false;
  const verbs = userMessage.match(MULTI_ACTION_VERBS) ?? [];
  return verbs.length >= 2;
}

export function classifySpokenAck(opts: {
  tool?: string | null;
  toolsThisTurn?: string[];
  userMessage?: string | null;
}): SpokenAckKind | null {
  const tools = opts.toolsThisTurn ?? (opts.tool ? [opts.tool] : []);
  const slow = tools.filter(
    (t) => !isInstantSpokenAction(t) && !NO_PREACK.has(t),
  );
  if (slow.length === 0) return null;
  if (slow.length >= 2 || looksLikeMultiSpokenAction(opts.userMessage)) {
    return "multi";
  }

  const tool = (opts.tool && slow.includes(opts.tool)
    ? opts.tool
    : slow[0] ?? ""
  ).toLowerCase();
  if (!tool || isInstantSpokenAction(tool) || NO_PREACK.has(tool)) return null;
  for (const row of ACK_BY_TOOL) {
    if (row.test(tool)) return row.kind;
  }
  if (tool.includes("calendar") || tool.includes("event")) return null;
  return "generic_slow";
}

export function spokenAcknowledgementText(
  kind: SpokenAckKind,
  opts?: { appName?: string | null },
): string {
  const app = opts?.appName?.trim();
  switch (kind) {
    case "open_app":
      return app ? `Opening ${app}.` : "Opening it.";
    case "close_app":
      return app ? `Closing ${app}.` : "Closing it.";
    case "search":
      return "Checking now.";
    case "navigate":
      return "Opening it.";
    case "file":
      return "Working on that.";
    case "calendar_write":
      return "I'll take care of that.";
    case "playlist_write":
      return "Updating the playlist.";
    case "multi":
      return "Working on that.";
    default:
      return "Working on that.";
  }
}
