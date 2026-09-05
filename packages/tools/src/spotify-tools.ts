import { z } from "zod";
import type { AurumTool, ToolResult } from "./types";
import type { ToolRegistry } from "./registry";

const emptySchema = z.object({});

const searchTrackSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe("Track title or search phrase"),
  artist: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Optional artist name to disambiguate"),
  limit: z.number().int().min(1).max(10).optional(),
});

const playTrackSchema = z.object({
  trackReference: z
    .string()
    .uuid()
    .describe(
      "Trusted track reference UUID from spotify_search_track — never invent a Spotify URI",
    ),
  deviceReference: z
    .string()
    .uuid()
    .optional()
    .describe("Optional trusted device reference from spotify_get_devices"),
});

const setVolumeSchema = z.object({
  percent: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Spotify playback volume 0–100 (not Windows master volume)"),
  deviceReference: z.string().uuid().optional(),
});

type SpotifyAction =
  | "get_playback_state"
  | "get_devices"
  | "search_track"
  | "play_track"
  | "pause"
  | "resume"
  | "next"
  | "previous"
  | "set_volume";

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
      return run(action, input as Record<string, unknown>);
    },
  };
}

export function createSpotifyGetPlaybackStateTool() {
  return spotifyTool({
    id: "spotify_get_playback_state",
    name: "Get Spotify playback state",
    description:
      "Read current Spotify playback (track, artist, playing/paused, volume). Use for 'what's playing?' and relative volume. Requires connected Spotify.",
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
    description:
      "List available Spotify playback devices as trusted references. Prefer the active device when playing.",
    inputSchema: emptySchema,
    permission: "READ",
    activityLabel: "Listing Spotify devices",
    action: "get_devices",
  });
}

export function createSpotifySearchTrackTool() {
  return spotifyTool({
    id: "spotify_search_track",
    name: "Search Spotify tracks",
    description:
      "Search Spotify for tracks. Returns trusted trackReference UUIDs — use those with spotify_play_track. Never invent Spotify URIs. If several matches look equally good, ask the user.",
    inputSchema: searchTrackSchema,
    permission: "READ",
    activityLabel: "Searching Spotify",
    action: "search_track",
  });
}

export function createSpotifyPlayTrackTool() {
  return spotifyTool({
    id: "spotify_play_track",
    name: "Play Spotify track",
    description:
      "Start playback of a track using a trusted trackReference from spotify_search_track. Do not pass raw Spotify URIs. Use open_application to launch the Spotify desktop app if needed first.",
    inputSchema: playTrackSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Playing track",
    action: "play_track",
  });
}

export function createSpotifyPauseTool() {
  return spotifyTool({
    id: "spotify_pause",
    name: "Pause Spotify",
    description:
      "Pause current Spotify playback. For 'pause it' when media context is Spotify.",
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
    description: "Resume paused Spotify playback. Does not restart the track.",
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
    description:
      "Go to the previous Spotify track. Only use for media 'go back' when Spotify media context is active.",
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
      "Set Spotify playback volume to an integer percent 0–100. Does not change Windows master volume. For relative requests ('turn it down'), read current volume first then set a new percent.",
    inputSchema: setVolumeSchema,
    permission: "SAFE_WRITE",
    activityLabel: "Setting Spotify volume",
    action: "set_volume",
  });
}

export function registerSpotifyTools(registry: ToolRegistry): void {
  registry.register(createSpotifyGetPlaybackStateTool());
  registry.register(createSpotifyGetDevicesTool());
  registry.register(createSpotifySearchTrackTool());
  registry.register(createSpotifyPlayTrackTool());
  registry.register(createSpotifyPauseTool());
  registry.register(createSpotifyResumeTool());
  registry.register(createSpotifyNextTool());
  registry.register(createSpotifyPreviousTool());
  registry.register(createSpotifySetVolumeTool());
}
