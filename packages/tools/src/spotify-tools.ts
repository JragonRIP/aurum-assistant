import { z } from "zod";
import type { AurumTool, ToolResult } from "./types";
import type { ToolRegistry } from "./registry";

const emptySchema = z.object({});

const searchTrackSchema = z.object({
  query: z.string().min(1).max(200),
  artist: z.string().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

const searchQuerySchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional(),
});

const playTrackSchema = z.object({
  trackReference: z
    .string()
    .uuid()
    .describe("Trusted track reference UUID — never invent a Spotify URI"),
  deviceReference: z.string().uuid().optional(),
});

const playContextSchema = z.object({
  contextReference: z
    .string()
    .uuid()
    .describe("Trusted album or playlist reference UUID"),
  deviceReference: z.string().uuid().optional(),
});

const setVolumeSchema = z.object({
  percent: z.number().int().min(0).max(100),
  deviceReference: z.string().uuid().optional(),
});

const shuffleSchema = z.object({
  enabled: z.boolean(),
  deviceReference: z.string().uuid().optional(),
});

const repeatSchema = z.object({
  state: z.enum(["off", "track", "context"]),
  deviceReference: z.string().uuid().optional(),
});

const transferSchema = z.object({
  deviceReference: z.string().uuid(),
  play: z.boolean().optional(),
});

const queueSchema = z.object({
  trackReference: z.string().uuid(),
  deviceReference: z.string().uuid().optional(),
});

const playlistIdSchema = z.object({
  playlistReference: z.string().uuid(),
});

const playlistItemsSchema = z.object({
  playlistReference: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional(),
});

const createPlaylistSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  public: z.boolean().optional(),
});

const renamePlaylistSchema = z.object({
  playlistReference: z.string().uuid(),
  name: z.string().min(1).max(100),
});

const playlistDescSchema = z.object({
  playlistReference: z.string().uuid(),
  description: z.string().max(300),
});

const playlistVisibilitySchema = z.object({
  playlistReference: z.string().uuid(),
  public: z.boolean(),
});

const playlistTracksSchema = z.object({
  playlistReference: z.string().uuid(),
  trackReferences: z.array(z.string().uuid()).min(1).max(100),
});

const playlistRemoveSchema = z.object({
  playlistReference: z.string().uuid(),
  trackReferences: z.array(z.string().uuid()).min(1).max(100),
});

const playlistReorderSchema = z.object({
  playlistReference: z.string().uuid(),
  rangeStart: z.number().int().min(0).max(10_000),
  insertBefore: z.number().int().min(0).max(10_000),
  rangeLength: z.number().int().min(1).max(100).optional(),
});

const libraryItemSchema = z.object({
  trackReference: z.string().uuid(),
});

export type SpotifyAction =
  | "get_playback_state"
  | "get_devices"
  | "get_queue"
  | "get_user_playlists"
  | "get_playlist"
  | "get_playlist_items"
  | "search_track"
  | "search_tracks"
  | "search_albums"
  | "search_artists"
  | "resolve_playlist"
  | "resolve_disambiguation"
  | "list_music_preferences"
  | "forget_music_preference"
  | "remember_music_preference"
  | "play_track"
  | "play_album"
  | "play_playlist"
  | "pause"
  | "resume"
  | "next"
  | "previous"
  | "set_volume"
  | "set_shuffle"
  | "set_repeat"
  | "transfer_playback"
  | "add_to_queue"
  | "save_item"
  | "remove_saved_item"
  | "check_saved_item"
  | "create_playlist"
  | "rename_playlist"
  | "change_playlist_description"
  | "change_playlist_visibility"
  | "add_playlist_items"
  | "remove_playlist_items"
  | "reorder_playlist_items";

function spotifyTool<T extends z.ZodTypeAny>(
  def: Omit<AurumTool<T>, "handler" | "environment"> & {
    inputSchema: T;
    action: SpotifyAction;
  },
): AurumTool<T> {
  const { action, ...rest } = def;
  return {
    ...rest,
    environment: "CLOUD",
    async handler(input, ctx): Promise<ToolResult> {
      const run = ctx.runSpotifyAction;
      if (!run) {
        return {
          success: false,
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: "Spotify integration is not available on this host.",
          },
          activityLabel: rest.activityLabel,
        };
      }
      return run(action, input as Record<string, unknown>, ctx);
    },
  };
}

export function createSpotifyGetPlaybackStateTool() {
  return spotifyTool({
    id: "spotify_get_playback_state",
    name: "Get Spotify playback state",
    description:
      "Read current Spotify playback. Use for 'what's playing?' and relative volume.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking playback",
    action: "get_playback_state",
  });
}

export function createSpotifyGetDevicesTool() {
  return spotifyTool({
    id: "spotify_get_devices",
    name: "Get Spotify devices",
    description: "List Spotify playback devices as trusted device references.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Listing Spotify devices",
    action: "get_devices",
  });
}

export function createSpotifyGetQueueTool() {
  return spotifyTool({
    id: "spotify_get_queue",
    name: "Get Spotify queue",
    description: "Read the current Spotify play queue.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Checking queue",
    action: "get_queue",
  });
}

export function createSpotifyGetUserPlaylistsTool() {
  return spotifyTool({
    id: "spotify_get_user_playlists",
    name: "Get Spotify playlists",
    description:
      "List the user's Spotify playlists as trusted playlist references (paginated library). Prefer spotify_resolve_playlist when the user names a playlist.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(200).optional(),
    }),
    permission: "READ",
    activityLabel: "Listing playlists",
    action: "get_user_playlists",
  });
}

export function createSpotifyGetPlaylistTool() {
  return spotifyTool({
    id: "spotify_get_playlist",
    name: "Get Spotify playlist",
    description: "Read playlist metadata from a trusted playlistReference.",
    inputSchema: playlistIdSchema,
    permission: "READ",
    activityLabel: "Loading playlist",
    action: "get_playlist",
  });
}

export function createSpotifyGetPlaylistItemsTool() {
  return spotifyTool({
    id: "spotify_get_playlist_items",
    name: "Get Spotify playlist items",
    description: "List tracks in a playlist as trusted track references.",
    inputSchema: playlistItemsSchema,
    permission: "READ",
    activityLabel: "Loading playlist tracks",
    action: "get_playlist_items",
  });
}

export function createSpotifySearchTrackTool() {
  return spotifyTool({
    id: "spotify_search_track",
    name: "Search Spotify tracks",
    description:
      "Search Spotify for tracks with preference memory + explicit-version ranking. Returns trusted trackReference UUIDs. Consults remembered resolutions before asking. Never invent Spotify URIs.",
    inputSchema: searchTrackSchema,
    permission: "READ",
    activityLabel: "Searching Spotify",
    action: "search_track",
  });
}

export function createSpotifySearchTracksTool() {
  return spotifyTool({
    id: "spotify_search_tracks",
    name: "Search Spotify tracks (batch)",
    description:
      "Search Spotify for multiple track candidates (playlist building). Returns trusted trackReferences.",
    inputSchema: searchTrackSchema,
    permission: "READ",
    activityLabel: "Searching tracks",
    action: "search_tracks",
  });
}

export function createSpotifySearchAlbumsTool() {
  return spotifyTool({
    id: "spotify_search_albums",
    name: "Search Spotify albums",
    description: "Search albums; returns trusted albumReference UUIDs.",
    inputSchema: searchQuerySchema,
    permission: "READ",
    activityLabel: "Searching albums",
    action: "search_albums",
  });
}

export function createSpotifySearchArtistsTool() {
  return spotifyTool({
    id: "spotify_search_artists",
    name: "Search Spotify artists",
    description: "Search artists; returns trusted artist labels (use for related searches).",
    inputSchema: searchQuerySchema,
    permission: "READ",
    activityLabel: "Searching artists",
    action: "search_artists",
  });
}

export function createSpotifyPlayTrackTool() {
  return spotifyTool({
    id: "spotify_play_track",
    name: "Play Spotify track",
    description:
      "Play a track via trusted trackReference. Use open_application to launch Spotify first if needed.",
    inputSchema: playTrackSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Playing track",
    action: "play_track",
  });
}

export function createSpotifyPlayAlbumTool() {
  return spotifyTool({
    id: "spotify_play_album",
    name: "Play Spotify album",
    description: "Play an album via trusted album reference (contextReference).",
    inputSchema: playContextSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Playing album",
    action: "play_album",
  });
}

export function createSpotifyPlayPlaylistTool() {
  return spotifyTool({
    id: "spotify_play_playlist",
    name: "Play Spotify playlist",
    description:
      "Play a playlist via trusted playlist reference (contextReference). Resolve with spotify_resolve_playlist first for named/my playlists.",
    inputSchema: playContextSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Playing playlist",
    action: "play_playlist",
  });
}

export function createSpotifyResolvePlaylistTool() {
  return spotifyTool({
    id: "spotify_resolve_playlist",
    name: "Resolve Spotify playlist by name",
    description:
      "Find the user's playlist by name (prefers owned library when they say 'my'). Uses remembered playlist preferences. Returns trusted playlistReference(s). On AMBIGUOUS_PLAYLIST, ask which one then call spotify_resolve_disambiguation.",
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      mineOnly: z
        .boolean()
        .optional()
        .describe("Default true. Set false only when not asking for 'my' playlist."),
    }),
    permission: "READ",
    activityLabel: "Finding playlist",
    action: "resolve_playlist",
  });
}

export function createSpotifyResolveDisambiguationTool() {
  return spotifyTool({
    id: "spotify_resolve_disambiguation",
    name: "Resolve music disambiguation",
    description:
      "Resolve a short clarification like 'Kirko' or 'Lil Wayne Hits' against the active candidate set from AMBIGUOUS_TRACK / AMBIGUOUS_PLAYLIST. Saves USER_SELECTED preference unless temporary=true. Use persist=true for 'from now on' / 'always'.",
    inputSchema: z.object({
      choice: z.string().min(1).max(200),
      temporary: z.boolean().optional(),
      persist: z.boolean().optional(),
    }),
    permission: "READ",
    activityLabel: "Resolving choice",
    action: "resolve_disambiguation",
  });
}

export function createSpotifyListMusicPreferencesTool() {
  return spotifyTool({
    id: "spotify_list_music_preferences",
    name: "List music preferences",
    description:
      "List remembered song/playlist resolutions for this user (inspectable memory).",
    inputSchema: z.object({
      intentType: z.enum(["track", "playlist", "album"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    permission: "READ",
    activityLabel: "Listing music memory",
    action: "list_music_preferences",
  });
}

export function createSpotifyForgetMusicPreferenceTool() {
  return spotifyTool({
    id: "spotify_forget_music_preference",
    name: "Forget music preference",
    description:
      "Delete a remembered music resolution by preferenceId or by query text (e.g. forget 'Drank in My Cup').",
    inputSchema: z.object({
      preferenceId: z.string().uuid().optional(),
      query: z.string().min(1).max(200).optional(),
      intentType: z.enum(["track", "playlist", "album"]).optional(),
    }),
    permission: "SAFE_WRITE",
    activityLabel: "Updating music memory",
    action: "forget_music_preference",
  });
}

export function createSpotifyRememberMusicPreferenceTool() {
  return spotifyTool({
    id: "spotify_remember_music_preference",
    name: "Remember music preference",
    description:
      "Persist an explicit mapping like 'When I say Drank in My Cup, I mean Kirko' using a trusted track/playlist reference.",
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      trackReference: z.string().uuid().optional(),
      playlistReference: z.string().uuid().optional(),
    }),
    permission: "SAFE_WRITE",
    activityLabel: "Saving music memory",
    action: "remember_music_preference",
  });
}

export function createSpotifyPauseTool() {
  return spotifyTool({
    id: "spotify_pause",
    name: "Pause Spotify",
    description: "Pause Spotify playback.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Pausing Spotify",
    action: "pause",
  });
}

export function createSpotifyResumeTool() {
  return spotifyTool({
    id: "spotify_resume",
    name: "Resume Spotify",
    description: "Resume paused Spotify playback.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Resuming Spotify",
    action: "resume",
  });
}

export function createSpotifyNextTool() {
  return spotifyTool({
    id: "spotify_next",
    name: "Skip to next Spotify track",
    description: "Skip to the next Spotify track.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Skipping track",
    action: "next",
  });
}

export function createSpotifyPreviousTool() {
  return spotifyTool({
    id: "spotify_previous",
    name: "Previous Spotify track",
    description: "Go to the previous Spotify track.",
    inputSchema: emptySchema,
    permission: "SAFE_WRITE",
    activityLabel: "Previous track",
    action: "previous",
  });
}

export function createSpotifySetVolumeTool() {
  return spotifyTool({
    id: "spotify_set_volume",
    name: "Set Spotify volume",
    description:
      "Set Spotify playback volume 0–100 (not Windows master volume).",
    inputSchema: setVolumeSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Setting Spotify volume",
    action: "set_volume",
  });
}

export function createSpotifySetShuffleTool() {
  return spotifyTool({
    id: "spotify_set_shuffle",
    name: "Set Spotify shuffle",
    description: "Enable or disable Spotify shuffle.",
    inputSchema: shuffleSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Setting shuffle",
    action: "set_shuffle",
  });
}

export function createSpotifySetRepeatTool() {
  return spotifyTool({
    id: "spotify_set_repeat",
    name: "Set Spotify repeat",
    description: "Set Spotify repeat mode: off, track, or context.",
    inputSchema: repeatSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Setting repeat",
    action: "set_repeat",
  });
}

export function createSpotifyTransferPlaybackTool() {
  return spotifyTool({
    id: "spotify_transfer_playback",
    name: "Transfer Spotify playback",
    description:
      "Move Spotify playback to a trusted deviceReference (e.g. this computer).",
    inputSchema: transferSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Transferring playback",
    action: "transfer_playback",
  });
}

export function createSpotifyAddToQueueTool() {
  return spotifyTool({
    id: "spotify_add_to_queue",
    name: "Add track to Spotify queue",
    description: "Queue a trusted trackReference.",
    inputSchema: queueSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Adding to queue",
    action: "add_to_queue",
  });
}

export function createSpotifySaveItemTool() {
  return spotifyTool({
    id: "spotify_save_item",
    name: "Save Spotify track",
    description: "Save a trusted track to the user's library ('Liked Songs').",
    inputSchema: libraryItemSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Saving track",
    action: "save_item",
  });
}

export function createSpotifyRemoveSavedItemTool() {
  return spotifyTool({
    id: "spotify_remove_saved_item",
    name: "Remove saved Spotify track",
    description: "Remove a trusted track from Liked Songs.",
    inputSchema: libraryItemSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Removing saved track",
    action: "remove_saved_item",
  });
}

export function createSpotifyCheckSavedItemTool() {
  return spotifyTool({
    id: "spotify_check_saved_item",
    name: "Check saved Spotify track",
    description: "Check whether a trusted track is in Liked Songs.",
    inputSchema: libraryItemSchema,
    permission: "READ",
    activityLabel: "Checking library",
    action: "check_saved_item",
  });
}

export function createSpotifyCreatePlaylistTool() {
  return spotifyTool({
    id: "spotify_create_playlist",
    name: "Create Spotify playlist",
    description:
      "Create a playlist. Defaults to private unless public=true. Returns a trusted playlistReference.",
    inputSchema: createPlaylistSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Creating playlist",
    action: "create_playlist",
  });
}

export function createSpotifyRenamePlaylistTool() {
  return spotifyTool({
    id: "spotify_rename_playlist",
    name: "Rename Spotify playlist",
    description: "Rename a playlist via trusted playlistReference.",
    inputSchema: renamePlaylistSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Renaming playlist",
    action: "rename_playlist",
  });
}

export function createSpotifyChangePlaylistDescriptionTool() {
  return spotifyTool({
    id: "spotify_change_playlist_description",
    name: "Change Spotify playlist description",
    description: "Update playlist description via trusted playlistReference.",
    inputSchema: playlistDescSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Updating playlist",
    action: "change_playlist_description",
  });
}

export function createSpotifyChangePlaylistVisibilityTool() {
  return spotifyTool({
    id: "spotify_change_playlist_visibility",
    name: "Change Spotify playlist visibility",
    description: "Make a playlist public or private. Requires confirmation.",
    inputSchema: playlistVisibilitySchema,
    permission: "CONFIRM",
    activityLabel: "Changing playlist visibility",
    action: "change_playlist_visibility",
  });
}

export function createSpotifyAddPlaylistItemsTool() {
  return spotifyTool({
    id: "spotify_add_playlist_items",
    name: "Add tracks to Spotify playlist",
    description:
      "Add trusted trackReferences to a playlist. Large batches may require confirmation.",
    inputSchema: playlistTracksSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Adding playlist tracks",
    action: "add_playlist_items",
  });
}

export function createSpotifyRemovePlaylistItemsTool() {
  return spotifyTool({
    id: "spotify_remove_playlist_items",
    name: "Remove tracks from Spotify playlist",
    description: "Remove trusted trackReferences from a playlist. Requires confirmation when many.",
    inputSchema: playlistRemoveSchema,
    permission: "CONFIRM",
    activityLabel: "Removing playlist tracks",
    action: "remove_playlist_items",
  });
}

export function createSpotifyReorderPlaylistItemsTool() {
  return spotifyTool({
    id: "spotify_reorder_playlist_items",
    name: "Reorder Spotify playlist items",
    description: "Reorder playlist items via Spotify's rangeStart/insertBefore API.",
    inputSchema: playlistReorderSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Reordering playlist",
    action: "reorder_playlist_items",
  });
}

export function registerSpotifyTools(registry: ToolRegistry): void {
  registry.register(createSpotifyGetPlaybackStateTool());
  registry.register(createSpotifyGetDevicesTool());
  registry.register(createSpotifyGetQueueTool());
  registry.register(createSpotifyGetUserPlaylistsTool());
  registry.register(createSpotifyGetPlaylistTool());
  registry.register(createSpotifyGetPlaylistItemsTool());
  registry.register(createSpotifySearchTrackTool());
  registry.register(createSpotifySearchTracksTool());
  registry.register(createSpotifySearchAlbumsTool());
  registry.register(createSpotifySearchArtistsTool());
  registry.register(createSpotifyResolvePlaylistTool());
  registry.register(createSpotifyResolveDisambiguationTool());
  registry.register(createSpotifyListMusicPreferencesTool());
  registry.register(createSpotifyForgetMusicPreferenceTool());
  registry.register(createSpotifyRememberMusicPreferenceTool());
  registry.register(createSpotifyPlayTrackTool());
  registry.register(createSpotifyPlayAlbumTool());
  registry.register(createSpotifyPlayPlaylistTool());
  registry.register(createSpotifyPauseTool());
  registry.register(createSpotifyResumeTool());
  registry.register(createSpotifyNextTool());
  registry.register(createSpotifyPreviousTool());
  registry.register(createSpotifySetVolumeTool());
  registry.register(createSpotifySetShuffleTool());
  registry.register(createSpotifySetRepeatTool());
  registry.register(createSpotifyTransferPlaybackTool());
  registry.register(createSpotifyAddToQueueTool());
  registry.register(createSpotifySaveItemTool());
  registry.register(createSpotifyRemoveSavedItemTool());
  registry.register(createSpotifyCheckSavedItemTool());
  registry.register(createSpotifyCreatePlaylistTool());
  registry.register(createSpotifyRenamePlaylistTool());
  registry.register(createSpotifyChangePlaylistDescriptionTool());
  registry.register(createSpotifyChangePlaylistVisibilityTool());
  registry.register(createSpotifyAddPlaylistItemsTool());
  registry.register(createSpotifyRemovePlaylistItemsTool());
  registry.register(createSpotifyReorderPlaylistItemsTool());
}
