export type IntegrationCapability =
  | "MEDIA_SEARCH"
  | "MEDIA_PLAY"
  | "MEDIA_PAUSE"
  | "MEDIA_SKIP"
  | "MEDIA_VOLUME"
  | "MEDIA_STATE"
  | "MEDIA_LIBRARY"
  | "MEDIA_PLAYLIST";

export type IntegrationAuthType = "oauth2_pkce";

export type IntegrationDefinition = {
  id: string;
  name: string;
  provider: string;
  authType: IntegrationAuthType;
  capabilities: IntegrationCapability[];
  tools: string[];
};

/** AppIntegrationRegistry entry — prefer official API over OS hacks. */
export const SPOTIFY: IntegrationDefinition = {
  id: "spotify",
  name: "Spotify",
  provider: "spotify",
  authType: "oauth2_pkce",
  capabilities: [
    "MEDIA_SEARCH",
    "MEDIA_PLAY",
    "MEDIA_PAUSE",
    "MEDIA_SKIP",
    "MEDIA_VOLUME",
    "MEDIA_STATE",
    "MEDIA_LIBRARY",
    "MEDIA_PLAYLIST",
  ],
  tools: [
    "spotify_get_playback_state",
    "spotify_get_devices",
    "spotify_get_queue",
    "spotify_get_user_playlists",
    "spotify_get_playlist",
    "spotify_get_playlist_items",
    "spotify_search_track",
    "spotify_search_tracks",
    "spotify_search_albums",
    "spotify_search_artists",
    "spotify_play_track",
    "spotify_play_album",
    "spotify_play_playlist",
    "spotify_pause",
    "spotify_resume",
    "spotify_next",
    "spotify_previous",
    "spotify_set_volume",
    "spotify_set_shuffle",
    "spotify_set_repeat",
    "spotify_transfer_playback",
    "spotify_add_to_queue",
    "spotify_save_item",
    "spotify_remove_saved_item",
    "spotify_check_saved_item",
    "spotify_create_playlist",
    "spotify_rename_playlist",
    "spotify_change_playlist_description",
    "spotify_change_playlist_visibility",
    "spotify_add_playlist_items",
    "spotify_remove_playlist_items",
    "spotify_reorder_playlist_items",
  ],
};

export const WINDOWS_SYSTEM = {
  id: "windows_system",
  name: "Windows System",
  provider: "windows",
  preferredOrder: [
    "official_api",
    "windows_media_system_api",
    "typed_application_adapter",
    "safe_os_actions",
  ] as const,
  forbidden: [
    "click_xy",
    "arbitrary_key_sequences",
    "arbitrary_scripting",
    "generic_ui_automation",
  ] as const,
};

export const INTEGRATION_DEFINITIONS: IntegrationDefinition[] = [SPOTIFY];

export function getIntegrationDefinition(
  provider: string,
): IntegrationDefinition | undefined {
  return INTEGRATION_DEFINITIONS.find((d) => d.provider === provider);
}
