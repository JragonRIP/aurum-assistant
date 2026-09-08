/**
 * Deterministic spoken shortening — no second model call.
 * Display / stored text is never mutated by this module.
 */

export type SpokenDetailMode = "concise" | "read_all";

export type SpokenToolHint = {
  tool?: string;
  message?: string;
  data?: Record<string, unknown> | null;
  success?: boolean;
  errorCode?: string;
};

const READ_ALL =
  /\b(read the whole thing|say all of it|explain it out loud|tell me everything)\b/i;

export function wantsFullSpokenReadback(userMessage?: string | null): boolean {
  return Boolean(userMessage && READ_ALL.test(userMessage));
}

export function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/**
 * Shorten assistant display prose for speech.
 * Conservative: never invent facts; only drop secondary detail.
 */
export function simplifySpokenText(
  text: string,
  opts?: {
    detailMode?: SpokenDetailMode;
    toolHints?: SpokenToolHint[];
    voiceOrigin?: boolean;
  },
): { text: string; simplified: boolean } {
  const source = text.replace(/\s+/g, " ").trim();
  if (!source) return { text: "", simplified: false };

  if (opts?.detailMode === "read_all") {
    return { text: source, simplified: false };
  }

  const fromTools = summarizeFromTools(opts?.toolHints ?? []);
  if (fromTools) {
    return { text: fromTools, simplified: fromTools !== source };
  }

  let t = applyKnownSpokenPatterns(source);

  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const voice = opts?.voiceOrigin !== false;
  const maxSentences = voice ? (sentences.length <= 1 ? 1 : 3) : 3;

  if (voice && sentences.length > maxSentences) {
    t = sentences.slice(0, maxSentences).join(" ");
  } else {
    t = sentences.join(" ");
  }

  t = t
    .replace(/\bsuccessfully\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();

  return { text: t, simplified: t !== source };
}

function summarizeFromTools(hints: SpokenToolHint[]): string | null {
  if (hints.length === 0) return null;
  if (hints.length >= 2) {
    const bits = hints
      .map((hint) => summarizeOneTool(hint))
      .filter((s): s is string => Boolean(s));
    if (bits.length >= 2) return bits.slice(0, 3).join(" ");
    if (bits.length === 1) return bits[0]!;
  }
  return summarizeOneTool(hints[hints.length - 1]!);
}

function summarizeOneTool(last: SpokenToolHint): string | null {
  const tool = (last.tool ?? "").toLowerCase();
  const data = last.data ?? {};
  const message = (last.message ?? "").trim();

  if (!last.success && last.errorCode) {
    if (
      last.errorCode === "MISSING_SCOPE" ||
      last.errorCode === "AUTH_REVOKED" ||
      last.errorCode === "TOKEN_EXPIRED"
    ) {
      return "I need you to reconnect Spotify.";
    }
    if (last.errorCode === "PLAYLIST_NOT_WRITABLE") {
      return "That playlist isn't writable.";
    }
    if (
      last.errorCode === "PROVIDER_UNAVAILABLE" &&
      tool.startsWith("web_")
    ) {
      return "Search is unavailable right now.";
    }
  }

  if (tool === "spotify_pause" || /pause/.test(tool)) {
    if (last.success) return "Paused.";
  }
  if (tool === "spotify_resume") {
    if (last.success) return "Playing again.";
  }
  if (tool === "spotify_play_track" || tool === "spotify_play_playlist") {
    const name =
      str(data.name) ||
      str(data.playlist) ||
      str(data.trackName) ||
      playlistNameFromMessage(message);
    if (name) return `${name} is playing.`;
    if (last.success) return "It's playing.";
  }
  if (tool === "open_application") {
    const app = str(data.name) || str(data.app) || appFromMessage(message, "open");
    if (app) return `${app} is open.`;
  }
  if (tool === "close_application") {
    const app = str(data.name) || str(data.app) || appFromMessage(message, "close");
    if (app) return `${app} is closed.`;
  }
  if (
    tool === "spotify_add_tracks_to_playlist" ||
    tool === "spotify_add_playlist_items"
  ) {
    const playlist = str(data.playlist) || playlistNameFromMessage(message);
    const track = str(data.track) || str(data.name);
    if (last.success && track && playlist) return `Added ${track} to ${playlist}.`;
    if (last.success && playlist) return `Added to ${playlist}.`;
    if (last.success) return "Added to the playlist.";
  }
  if (tool.startsWith("web_") && last.success === false) {
    return "Search is unavailable right now.";
  }
  if (
    (tool.includes("download") || tool.includes("save") || tool.includes("write_file")) &&
    last.success
  ) {
    const folder = str(data.folder) || str(data.folderName);
    if (folder) return `Saved to ${folder}.`;
    return "Saved.";
  }

  return null;
}

function applyKnownSpokenPatterns(text: string): string {
  let t = text;

  t = t.replace(
    /Spotify is open and (?:your )?(.+?) playlist is (?:playing|ready)\.?/i,
    (_, name: string) => `${trimName(name)} is playing.`,
  );
  t = t.replace(
    /(?:The search service|Web search) is temporarily unavailable, but Spotify opened successfully\.?/i,
    "Spotify's open. Search is unavailable right now.",
  );
  t = t.replace(
    /I found (\w+) (?:events|meetings|items) on your (?:calendar|schedule) today\.\s*(.+)/i,
    (_full, n: string, rest: string) => {
      const items = [
        ...rest.matchAll(
          /\b((?:class|meeting|call|lunch|appointment|event)s?(?:\s+\w+)?\s+at\s+\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)/gi,
        ),
      ].map((m) => m[1]!.trim());
      if (items.length === 0) return `You have ${n} things today.`;
      return `You have ${n} things today. ${items.join(", ")}.`;
    },
  );
  t = t.replace(
    /The file was saved successfully to your (.+?) folder\.?/i,
    (_, folder: string) => `Saved to ${trimName(folder)}.`,
  );
  t = t.replace(
    /I need you to reconnect Spotify once so Aurum can edit playlists\.?/i,
    "I need you to reconnect Spotify.",
  );
  t = t.replace(
    /I found the playlist, but this Spotify account can't edit it\.?/i,
    "That playlist isn't writable.",
  );

  return t.trim();
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function trimName(s: string): string {
  return s.replace(/^your\s+/i, "").replace(/\s+/g, " ").trim();
}

function playlistNameFromMessage(message: string): string | null {
  const m =
    message.match(/to (?:your )?(.+?)(?:\.|$)/i) ||
    message.match(/playlist (.+?)(?:\.|$)/i);
  return m?.[1] ? trimName(m[1]) : null;
}

function appFromMessage(message: string, verb: "open" | "close"): string | null {
  const re =
    verb === "open"
      ? /(?:opened|open)\s+(.+?)(?:\.|$)/i
      : /(?:closed|close[d]?)\s+(.+?)(?:\.|$)/i;
  const m = message.match(re);
  return m?.[1] ? trimName(m[1]) : null;
}
