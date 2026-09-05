export type IntegrationCapability =
  | "MEDIA_SEARCH"
  | "MEDIA_PLAY"
  | "MEDIA_PAUSE"
  | "MEDIA_SKIP"
  | "MEDIA_VOLUME"
  | "MEDIA_STATE";

export type IntegrationAuthType = "oauth2_pkce";

export type IntegrationDefinition = {
  id: string;
  name: string;
  provider: string;
  authType: IntegrationAuthType;
  capabilities: IntegrationCapability[];
  tools: string[];
};

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
  ],
  tools: [
    "spotify_get_playback_state",
    "spotify_get_devices",
    "spotify_search_track",
    "spotify_play_track",
    "spotify_pause",
    "spotify_resume",
    "spotify_next",
    "spotify_previous",
    "spotify_set_volume",
  ],
};

export const INTEGRATION_DEFINITIONS: IntegrationDefinition[] = [SPOTIFY];

export function getIntegrationDefinition(
  provider: string,
): IntegrationDefinition | undefined {
  return INTEGRATION_DEFINITIONS.find((d) => d.provider === provider);
}
