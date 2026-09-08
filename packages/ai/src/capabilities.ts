/**
 * Canonical capability summary derived from registered tools + session state.
 * Injected into the system prompt so Aurum does not invent permanent inability.
 */

export type CapabilitySessionFlags = {
  /** Tool ids from the live registry for this turn */
  registeredToolIds: string[];
  spotifyConnected?: boolean;
  spotifyMissingScopes?: string[];
  windowsDeviceOnline?: boolean;
  approvedFolderCount?: number;
  voiceAvailable?: boolean;
  memoryAvailable?: boolean;
};

function has(ids: Set<string>, id: string): boolean {
  return ids.has(id);
}

function any(ids: Set<string>, prefix: string): boolean {
  for (const id of ids) {
    if (id.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Build a session capability block. Never exposes internal mode names.
 * Distinguishes: capability registered vs temporarily failed vs permission missing.
 */
export function buildCapabilitySummary(flags: CapabilitySessionFlags): string {
  const ids = new Set(flags.registeredToolIds);
  const lines: string[] = [
    "Live capabilities for this session (from registered tools — trust this over stale assumptions):",
    "- Tool-first: when a matching tool exists, call it. Do not answer from assumptions about inability.",
    "- Temporary provider failures are not permanent capability loss. Say the action failed and you can retry — never rewrite that as “I can't access the web/Spotify.”",
  ];

  // Web
  if (has(ids, "web_search")) {
    lines.push(
      "- Web search: AVAILABLE via web_search (background research; does not open a browser).",
    );
  } else {
    lines.push("- Web search: not registered in this session.");
  }
  if (has(ids, "web_read_page")) {
    lines.push("- Page reading: AVAILABLE via web_read_page.");
  }
  if (has(ids, "web_image_search")) {
    lines.push(
      "- Image search: AVAILABLE via web_image_search (distinct from text web_search).",
    );
  } else {
    lines.push("- Image search: not available in this session.");
  }
  if (has(ids, "web_download_file")) {
    const folders = flags.approvedFolderCount ?? 0;
    if (!flags.windowsDeviceOnline) {
      lines.push(
        "- Downloads: tool registered, but Windows device is offline — cannot save files until the device is connected.",
      );
    } else if (folders <= 0) {
      lines.push(
        "- Downloads: AVAILABLE via web_download_file after the user approves a folder (list_approved_folders). Do not invent paths or claim downloads are impossible forever.",
      );
    } else {
      lines.push(
        `- Downloads: AVAILABLE via web_download_file into approved folders (${folders} approved). Use trusted sourceRef + folderReference.`,
      );
    }
  } else {
    lines.push("- Downloads: not registered in this session.");
  }
  if (has(ids, "open_url") || has(ids, "open_search")) {
    lines.push(
      "- Browser navigation: AVAILABLE via open_url / open_search when the user wants a site opened (not for research).",
    );
  }

  // Spotify
  if (any(ids, "spotify_")) {
    if (flags.spotifyConnected === false) {
      lines.push(
        "- Spotify tools are registered but Spotify is not connected — say so and point to Settings → Integrations.",
      );
    } else {
      lines.push(
        "- Spotify: tools registered (playback, queue read/add, playlist create/add/remove, search). Prefer tools over claiming inability.",
      );
      if (has(ids, "spotify_clear_queue")) {
        lines.push(
          "- Spotify queue clear: NOT supported by Spotify's API — spotify_clear_queue returns unsupported; never fake success.",
        );
      }
      if (has(ids, "spotify_set_playlist_cover")) {
        lines.push(
          "- Playlist cover upload: tool registered (JPEG ≤256KB via imageReference). May require Spotify reconnect for ugc-image-upload.",
        );
      }
      if (flags.spotifyMissingScopes && flags.spotifyMissingScopes.length > 0) {
        const playlistWriteMissing = flags.spotifyMissingScopes.some((s) =>
          s.startsWith("playlist-modify"),
        );
        lines.push(
          playlistWriteMissing
            ? "- Spotify playlist editing requires a reconnect in Settings. If a playlist tool returns MISSING_SCOPE, ask the user to reconnect — do not keep retrying the write."
            : `- Spotify missing scopes (reconnect required for full access): ${flags.spotifyMissingScopes.join(", ")}.`,
        );
      }
    }
  }

  // Windows
  if (flags.windowsDeviceOnline) {
    lines.push(
      "- Windows device: online — typed file/window/system tools may run under approved roots.",
    );
  } else if (any(ids, "list_") || has(ids, "open_application")) {
    lines.push(
      "- Windows device: offline or unpaired — device tools will fail until connected.",
    );
  }

  if (flags.memoryAvailable !== false && any(ids, "memory_")) {
    lines.push("- Long-term memory tools: AVAILABLE.");
  }
  if (flags.voiceAvailable) {
    lines.push(
      "- Voice: available on desktop (same personality; spoken replies stay concise).",
    );
  }

  lines.push(
    "- Not connected yet unless tools say otherwise: Gmail, Google Calendar, automations.",
  );
  lines.push(
    "- Capability ≠ permission: a tool may exist while approvals, scopes, or approved folders are still required.",
  );

  return lines.join("\n");
}

/** Tool ids from a registry-like object */
export function toolIdsFromRegistry(registry: {
  list?: () => Array<{ id: string }>;
  getAll?: () => Array<{ id: string }>;
  // ToolRegistry uses values
}): string[] {
  if (typeof registry.list === "function") {
    return registry.list().map((t) => t.id);
  }
  return [];
}
