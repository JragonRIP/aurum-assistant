import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolResult } from "@aurum/tools";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptSecret, decryptSecret } from "../crypto";
import {
  buildSpotifyAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
  getSpotifyClientConfig,
  isSpotifyConfigured,
  SPOTIFY_SCOPES,
  SPOTIFY_SCOPES_STRING,
} from "./oauth";
import { SpotifyAdapter, SpotifyApiError } from "./adapter";
import {
  createIntegrationReference,
  resolveIntegrationReference,
} from "./references";
import {
  clampVolume,
  setMediaContext,
  type MediaContext,
} from "../media-context";

export type SpotifyConnectionStatus =
  | "disconnected"
  | "connected"
  | "reconnect_required"
  | "error"
  | "not_configured";

export type SpotifyConnectionPublic = {
  provider: "spotify";
  name: string;
  status: SpotifyConnectionStatus;
  accountLabel: string | null;
  connectedAt: string | null;
  lastError: string | null;
  scopes: string[];
  configured: boolean;
};

type IntegrationRow = {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  account_label: string | null;
  external_account_id: string | null;
  connected_at: string | null;
  last_error: string | null;
  scopes: string[] | null;
  metadata: Record<string, unknown>;
};

type CredentialRow = {
  id: string;
  integration_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  token_type: string;
};

function toToolError(err: unknown): ToolResult {
  if (err instanceof SpotifyApiError) {
    return {
      success: false,
      error: { code: err.code, message: err.message },
      activityLabel: "Spotify action failed",
    };
  }
  return {
    success: false,
    error: {
      code: "EXECUTION_FAILED",
      message: err instanceof Error ? err.message : "Spotify action failed.",
    },
    activityLabel: "Spotify action failed",
  };
}

export async function listIntegrationStatuses(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ integrations: SpotifyConnectionPublic[] }> {
  const spotify = await getSpotifyConnectionPublic(supabase, userId);
  return { integrations: [spotify] };
}

export async function getSpotifyConnectionPublic(
  supabase: SupabaseClient,
  userId: string,
): Promise<SpotifyConnectionPublic> {
  const configured = isSpotifyConfigured();
  const { data } = await supabase
    .from("integrations")
    .select(
      "id, user_id, provider, status, account_label, external_account_id, connected_at, last_error, scopes, metadata",
    )
    .eq("user_id", userId)
    .eq("provider", "spotify")
    .maybeSingle();

  if (!data) {
    return {
      provider: "spotify",
      name: "Spotify",
      status: configured ? "disconnected" : "not_configured",
      accountLabel: null,
      connectedAt: null,
      lastError: null,
      scopes: [],
      configured,
    };
  }

  const row = data as IntegrationRow;
  return {
    provider: "spotify",
    name: "Spotify",
    status: configured
      ? (row.status as SpotifyConnectionStatus)
      : "not_configured",
    accountLabel: row.account_label,
    connectedAt: row.connected_at,
    lastError: row.last_error,
    scopes: row.scopes ?? [],
    configured,
  };
}

export async function startSpotifyConnect(opts: {
  supabase: SupabaseClient;
  userId: string;
  redirectTo?: string;
}): Promise<{ authorizeUrl: string }> {
  if (!isSpotifyConfigured()) {
    throw new Error("Spotify is not configured on this server.");
  }

  const state = generateOAuthState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await opts.supabase.from("integration_oauth_states").insert({
    user_id: opts.userId,
    provider: "spotify",
    state,
    code_verifier: codeVerifier,
    redirect_to: opts.redirectTo ?? "/settings?spotify=connected",
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(error.message || "Could not start Spotify OAuth");
  }

  const authorizeUrl = buildSpotifyAuthorizeUrl({ state, codeChallenge });
  return { authorizeUrl };
}

export async function completeSpotifyOAuth(opts: {
  supabase: SupabaseClient;
  userId: string;
  code: string;
  state: string;
}): Promise<{ redirectTo: string }> {
  const { data: stateRow, error: stateError } = await opts.supabase
    .from("integration_oauth_states")
    .select("id, user_id, provider, state, code_verifier, redirect_to, expires_at")
    .eq("state", opts.state)
    .eq("provider", "spotify")
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (stateError || !stateRow) {
    throw new Error("Invalid OAuth state");
  }

  if (new Date(stateRow.expires_at as string).getTime() < Date.now()) {
    await opts.supabase
      .from("integration_oauth_states")
      .delete()
      .eq("id", stateRow.id);
    throw new Error("OAuth state expired");
  }

  const userId = opts.userId;
  const codeVerifier = stateRow.code_verifier as string;
  const redirectTo =
    (stateRow.redirect_to as string | null) ?? "/settings?spotify=connected";

  const { clientId, clientSecret, redirectUri } = getSpotifyClientConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    await opts.supabase
      .from("integration_oauth_states")
      .delete()
      .eq("id", stateRow.id);
    throw new Error("Spotify token exchange failed");
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };

  // Fetch display name — never log tokens
  let accountLabel: string | null = null;
  let externalAccountId: string | null = null;
  try {
    const meRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as {
        id?: string;
        display_name?: string;
        email?: string;
      };
      externalAccountId = me.id ?? null;
      accountLabel = me.display_name || me.email || me.id || null;
    }
  } catch {
    // non-fatal
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const { data: integration, error: upsertError } = await opts.supabase
    .from("integrations")
    .upsert(
      {
        user_id: userId,
        provider: "spotify",
        status: "connected",
        account_label: accountLabel,
        external_account_id: externalAccountId,
        connected_at: new Date().toISOString(),
        last_error: null,
        scopes: (tokens.scope ?? SPOTIFY_SCOPES_STRING).split(" ").filter(Boolean),
        metadata: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    )
    .select("id")
    .single();

  if (upsertError || !integration) {
    throw new Error(upsertError?.message ?? "Could not save Spotify connection");
  }

  const service = createServiceClient();
  const accessCipher = encryptSecret(tokens.access_token);
  const refreshCipher = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : null;

  const { error: credError } = await service.from("integration_credentials").upsert(
    {
      user_id: userId,
      integration_id: integration.id,
      access_token_ciphertext: accessCipher,
      refresh_token_ciphertext: refreshCipher,
      token_expires_at: expiresAt,
      token_type: tokens.token_type ?? "Bearer",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "integration_id" },
  );

  if (credError) {
    throw new Error("Could not store Spotify credentials");
  }

  await opts.supabase
    .from("integration_oauth_states")
    .delete()
    .eq("id", stateRow.id);

  return { redirectTo };
}

export async function disconnectSpotify(opts: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<void> {
  const { data: integration } = await opts.supabase
    .from("integrations")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("provider", "spotify")
    .maybeSingle();

  if (integration?.id) {
    try {
      const service = createServiceClient();
      await service
        .from("integration_credentials")
        .delete()
        .eq("integration_id", integration.id)
        .eq("user_id", opts.userId);
    } catch {
      // service role may be missing in some envs — still mark disconnected
    }
  }

  await opts.supabase
    .from("integrations")
    .upsert(
      {
        user_id: opts.userId,
        provider: "spotify",
        status: "disconnected",
        account_label: null,
        external_account_id: null,
        connected_at: null,
        last_error: null,
        scopes: [],
        metadata: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

  await opts.supabase
    .from("integration_references")
    .delete()
    .eq("user_id", opts.userId)
    .eq("provider", "spotify");
}

async function loadIntegration(
  supabase: SupabaseClient,
  userId: string,
): Promise<IntegrationRow | null> {
  const { data } = await supabase
    .from("integrations")
    .select(
      "id, user_id, provider, status, account_label, external_account_id, connected_at, last_error, scopes, metadata",
    )
    .eq("user_id", userId)
    .eq("provider", "spotify")
    .maybeSingle();
  return (data as IntegrationRow | null) ?? null;
}

async function loadCredentials(
  userId: string,
  integrationId: string,
): Promise<CredentialRow | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("integration_credentials")
    .select(
      "id, integration_id, access_token_ciphertext, refresh_token_ciphertext, token_expires_at, token_type",
    )
    .eq("user_id", userId)
    .eq("integration_id", integrationId)
    .maybeSingle();
  return (data as CredentialRow | null) ?? null;
}

async function refreshAccessToken(opts: {
  userId: string;
  integrationId: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresAt: string | null }> {
  const { clientId, clientSecret } = getSpotifyClientConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
    }),
  });

  if (!res.ok) {
    throw new SpotifyApiError(
      "TOKEN_EXPIRED",
      "Spotify session expired. Reconnect in Settings.",
      res.status,
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const expiresAt = json.expires_in
    ? new Date(Date.now() + json.expires_in * 1000).toISOString()
    : null;

  const service = createServiceClient();
  const patch: Record<string, unknown> = {
    access_token_ciphertext: encryptSecret(json.access_token),
    token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  if (json.refresh_token) {
    patch.refresh_token_ciphertext = encryptSecret(json.refresh_token);
  }

  await service
    .from("integration_credentials")
    .update(patch)
    .eq("integration_id", opts.integrationId)
    .eq("user_id", opts.userId);

  return { accessToken: json.access_token, expiresAt };
}

export async function ensureAccessToken(opts: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{ accessToken: string; integration: IntegrationRow }> {
  const integration = await loadIntegration(opts.supabase, opts.userId);
  if (!integration || integration.status !== "connected") {
    throw new SpotifyApiError(
      "NOT_CONNECTED",
      "Spotify is not connected. Connect it in Settings → Integrations.",
    );
  }

  const creds = await loadCredentials(opts.userId, integration.id);
  if (!creds) {
    throw new SpotifyApiError(
      "NOT_CONNECTED",
      "Spotify credentials missing. Reconnect in Settings.",
    );
  }

  const expiresAt = creds.token_expires_at
    ? new Date(creds.token_expires_at).getTime()
    : 0;
  const skewMs = 60_000;
  let accessToken = decryptSecret(creds.access_token_ciphertext);

  if (expiresAt && Date.now() > expiresAt - skewMs) {
    if (!creds.refresh_token_ciphertext) {
      await opts.supabase
        .from("integrations")
        .update({
          status: "reconnect_required",
          last_error: "Refresh token missing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);
      throw new SpotifyApiError(
        "TOKEN_EXPIRED",
        "Spotify session expired. Reconnect in Settings.",
      );
    }
    try {
      const refreshToken = decryptSecret(creds.refresh_token_ciphertext);
      const refreshed = await refreshAccessToken({
        userId: opts.userId,
        integrationId: integration.id,
        refreshToken,
      });
      accessToken = refreshed.accessToken;
    } catch (err) {
      await opts.supabase
        .from("integrations")
        .update({
          status: "reconnect_required",
          last_error: "Token refresh failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);
      if (err instanceof SpotifyApiError) throw err;
      throw new SpotifyApiError(
        "TOKEN_EXPIRED",
        "Spotify session expired. Reconnect in Settings.",
      );
    }
  }

  return { accessToken, integration };
}

function updateMediaFromPlayback(
  conversationId: string | undefined,
  state: {
    isPlaying?: boolean;
    volumePercent?: number | null;
    track?: { name: string; artists: string[] } | null;
  },
  extra?: Partial<MediaContext>,
) {
  if (!conversationId) return;
  setMediaContext(conversationId, {
    isPlaying: state.isPlaying,
    volumePercent:
      state.volumePercent != null ? clampVolume(state.volumePercent) : undefined,
    trackLabel: state.track?.name,
    artistLabel: state.track?.artists?.join(", "),
    ...extra,
  });
}

export async function runSpotifyTool(opts: {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string;
  action: string;
  input: Record<string, unknown>;
}): Promise<ToolResult> {
  try {
    if (!isSpotifyConfigured()) {
      return {
        success: false,
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Spotify is not configured on this server.",
        },
        activityLabel: "Spotify unavailable",
      };
    }

    const { accessToken } = await ensureAccessToken({
      supabase: opts.supabase,
      userId: opts.userId,
    });
    const adapter = new SpotifyAdapter(accessToken);

    switch (opts.action) {
      case "get_playback_state": {
        const state = await adapter.getPlaybackState();
        if (!state) {
          return {
            success: true,
            data: { isPlaying: false, track: null, device: null },
            message: "Nothing is playing on Spotify.",
            activityLabel: "Checked playback",
          };
        }
        updateMediaFromPlayback(opts.conversationId, state);
        return {
          success: true,
          data: {
            isPlaying: state.isPlaying,
            progressMs: state.progressMs,
            volumePercent: state.volumePercent,
            track: state.track
              ? {
                  name: state.track.name,
                  artists: state.track.artists,
                  album: state.track.album,
                  durationMs: state.track.durationMs,
                }
              : null,
            device: state.device
              ? {
                  name: state.device.name,
                  type: state.device.type,
                  active: state.device.isActive,
                  volumePercent: state.device.volumePercent,
                }
              : null,
          },
          message: state.track
            ? `${state.track.name} — ${state.track.artists.join(", ")}`
            : "Playback state loaded.",
          activityLabel: "Checked playback",
        };
      }

      case "get_devices": {
        const devices = await adapter.getDevices();
        const sanitized = [];
        for (const d of devices) {
          if (!d.id) continue;
          const ref = await createIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            provider: "spotify",
            kind: "device",
            providerId: d.id,
            providerUri: `spotify:device:${d.id}`,
            label: d.name,
            subtitle: d.type,
            payload: {
              isActive: d.isActive,
              isRestricted: d.isRestricted,
              volumePercent: d.volumePercent,
            },
            conversationId: opts.conversationId,
          });
          sanitized.push({
            referenceId: ref.id,
            name: d.name,
            type: d.type,
            active: d.isActive,
            restricted: d.isRestricted,
            volumePercent: d.volumePercent,
          });
        }
        return {
          success: true,
          data: { devices: sanitized },
          message:
            sanitized.length === 0
              ? "No Spotify playback devices available."
              : `Found ${sanitized.length} Spotify device(s).`,
          activityLabel: "Listed Spotify devices",
        };
      }

      case "search_track": {
        const query = String(opts.input.query ?? "").trim();
        const artist =
          typeof opts.input.artist === "string"
            ? opts.input.artist.trim()
            : undefined;
        const limit =
          typeof opts.input.limit === "number" ? opts.input.limit : 5;
        if (!query) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Search query is required.",
            },
            activityLabel: "Search failed",
          };
        }
        const hits = await adapter.searchTracks({ query, artist, limit });
        if (hits.length === 0) {
          return {
            success: false,
            error: {
              code: "TRACK_NOT_FOUND",
              message: "No matching Spotify tracks found.",
            },
            activityLabel: "Track not found",
          };
        }

        const tracks = [];
        for (const t of hits) {
          const ref = await createIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            provider: "spotify",
            kind: "track",
            providerId: t.id,
            providerUri: t.uri,
            label: t.name,
            subtitle: t.artists.join(", "),
            payload: {
              album: t.album,
              durationMs: t.durationMs,
              artists: t.artists,
            },
            conversationId: opts.conversationId,
          });
          tracks.push({
            referenceId: ref.id,
            name: t.name,
            artists: t.artists,
            album: t.album,
            durationMs: t.durationMs,
          });
        }

        const ambiguous =
          tracks.length > 1 &&
          !artist &&
          new Set(tracks.map((t) => t.artists.join("|").toLowerCase())).size >
            1;

        if (ambiguous) {
          return {
            success: false,
            error: {
              code: "AMBIGUOUS_TRACK",
              message: "Multiple plausible tracks — ask which artist.",
            },
            data: { tracks, ambiguous: true },
            message: `Found ${tracks.length} tracks. Ask which one.`,
            activityLabel: query ? `Found ${query}` : "Search complete",
          };
        }

        return {
          success: true,
          data: { tracks, ambiguous: false },
          message: `Found ${tracks.length} track(s).`,
          activityLabel: query ? `Found ${query}` : "Search complete",
        };
      }

      case "play_track": {
        const trackRef = await resolveIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          referenceId: opts.input.trackReference,
          provider: "spotify",
          kind: "track",
        });
        if (!trackRef) {
          return {
            success: false,
            error: {
              code: "TRACK_NOT_FOUND",
              message:
                "Invalid or expired track reference. Search again with spotify_search_track.",
            },
            activityLabel: "Play failed",
          };
        }

        let deviceId: string | undefined;
        if (opts.input.deviceReference) {
          const deviceRef = await resolveIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            referenceId: opts.input.deviceReference,
            provider: "spotify",
            kind: "device",
          });
          if (!deviceRef) {
            return {
              success: false,
              error: {
                code: "NO_ACTIVE_DEVICE",
                message: "Invalid or expired device reference.",
              },
              activityLabel: "Play failed",
            };
          }
          deviceId = deviceRef.provider_id;
        }

        try {
          await adapter.play({ uris: [trackRef.provider_uri], deviceId });
        } catch (err) {
          if (
            err instanceof SpotifyApiError &&
            err.code === "NO_ACTIVE_DEVICE"
          ) {
            // Short bounded wait for desktop client to appear
            for (let i = 0; i < 4; i++) {
              await new Promise((r) => setTimeout(r, 800));
              const devices = await adapter.getDevices();
              const usable = devices.find((d) => d.id && !d.isRestricted);
              if (usable) {
                await adapter.play({
                  uris: [trackRef.provider_uri],
                  deviceId: usable.id,
                });
                deviceId = usable.id;
                break;
              }
              if (i === 3) throw err;
            }
          } else {
            throw err;
          }
        }

        if (opts.conversationId) {
          setMediaContext(opts.conversationId, {
            trackLabel: trackRef.label,
            artistLabel: trackRef.subtitle ?? undefined,
            isPlaying: true,
            trackReference: trackRef.id,
          });
        }

        return {
          success: true,
          data: {
            track: trackRef.label,
            artists: trackRef.subtitle,
            referenceId: trackRef.id,
          },
          message: trackRef.subtitle
            ? `Playing ${trackRef.label} — ${trackRef.subtitle}.`
            : `Playing ${trackRef.label}.`,
          activityLabel: `Playing ${trackRef.label}`,
        };
      }

      case "pause": {
        await adapter.pause();
        if (opts.conversationId) {
          setMediaContext(opts.conversationId, { isPlaying: false });
        }
        return {
          success: true,
          message: "Paused Spotify.",
          activityLabel: "Paused Spotify",
        };
      }

      case "resume": {
        await adapter.resume();
        if (opts.conversationId) {
          setMediaContext(opts.conversationId, { isPlaying: true });
        }
        return {
          success: true,
          message: "Resumed Spotify.",
          activityLabel: "Resumed Spotify",
        };
      }

      case "next": {
        await adapter.next();
        return {
          success: true,
          message: "Skipped to next track.",
          activityLabel: "Skipped track",
        };
      }

      case "previous": {
        await adapter.previous();
        return {
          success: true,
          message: "Went to previous track.",
          activityLabel: "Previous track",
        };
      }

      case "set_volume": {
        const percent = clampVolume(Number(opts.input.percent));
        let deviceId: string | undefined;
        if (opts.input.deviceReference) {
          const deviceRef = await resolveIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            referenceId: opts.input.deviceReference,
            provider: "spotify",
            kind: "device",
          });
          deviceId = deviceRef?.provider_id;
        }
        await adapter.setVolume(percent, deviceId);
        if (opts.conversationId) {
          setMediaContext(opts.conversationId, { volumePercent: percent });
        }
        return {
          success: true,
          data: { percent },
          message: `Spotify volume set to ${percent}%.`,
          activityLabel: "Volume set",
        };
      }

      default:
        return {
          success: false,
          error: {
            code: "UNKNOWN_TOOL",
            message: `Unknown Spotify action: ${opts.action}`,
          },
        };
    }
  } catch (err) {
    return toToolError(err);
  }
}

export { SPOTIFY_SCOPES, isSpotifyConfigured };
