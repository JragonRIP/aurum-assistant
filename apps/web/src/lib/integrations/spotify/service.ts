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
  needsSpotifyScopeUpgrade,
  missingSpotifyScopes,
} from "./oauth";
import { SpotifyAdapter, SpotifyApiError } from "./adapter";
import {
  createIntegrationReference,
  resolveIntegrationReference,
} from "./references";
import {
  ensureSpotifyPlaybackDevice,
  type RecoverableDevice,
} from "./device-recovery";
import {
  clampVolume,
  setMediaContext,
  type MediaContext,
} from "../media-context";
import {
  resolveTrackSearch,
  resolveUserPlaylist,
  learnFromSuccessfulPlay,
} from "./music-resolve";
import { normalizeMusicQuery } from "./music-query";
import {
  getActiveDisambiguationSession,
  markDisambiguationResolved,
  resolveChoiceAgainstCandidates,
  expireActiveDisambiguationSessions,
} from "./disambiguation";
import {
  clearMusicPreferences,
  deleteMusicPreference,
  forgetMusicPreferenceByQuery,
  listMusicPreferences,
  upsertMusicPreference,
} from "./music-preferences";
import {
  runVerifiedPlayPauseMutation,
  runVerifiedSkipMutation,
  snapshotFromPlayback,
} from "./playback-mutation";

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
  requiredScopes: string[];
  missingScopes: string[];
  needsScopeUpgrade: boolean;
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
  if (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  ) {
    return {
      success: false,
      error: { code: "CANCELLED", message: "Cancelled." },
      activityLabel: "Cancelled",
    };
  }
  if (err instanceof SpotifyApiError) {
    return {
      success: false,
      error: { code: err.code, message: err.message },
      activityLabel: "Spotify action failed",
      data:
        err.code === "RATE_LIMITED"
          ? {
              confirmation: "RATE_LIMITED",
              ...(err.retryAfterMs != null
                ? { retryAfterMs: err.retryAfterMs }
                : {}),
            }
          : err.code === "NO_ACTIVE_DEVICE"
            ? { confirmation: "NO_DEVICE" }
            : { confirmation: "FAILED" },
    };
  }
  return {
    success: false,
    error: {
      code: "EXECUTION_FAILED",
      message: err instanceof Error ? err.message : "Spotify action failed.",
    },
    activityLabel: "Spotify action failed",
    data: { confirmation: "FAILED" },
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
      requiredScopes: [...SPOTIFY_SCOPES],
      missingScopes: [...SPOTIFY_SCOPES],
      needsScopeUpgrade: false,
      configured,
    };
  }

  const row = data as IntegrationRow;
  const scopes = row.scopes ?? [];
  const missing = missingSpotifyScopes(scopes);
  const needsUpgrade =
    row.status === "connected" && needsSpotifyScopeUpgrade(scopes);
  return {
    provider: "spotify",
    name: "Spotify",
    status: configured
      ? needsUpgrade
        ? "reconnect_required"
        : (row.status as SpotifyConnectionStatus)
      : "not_configured",
    accountLabel: row.account_label,
    connectedAt: row.connected_at,
    lastError: needsUpgrade
      ? "New Spotify permissions required — reconnect to upgrade."
      : row.last_error,
    scopes,
    requiredScopes: [...SPOTIFY_SCOPES],
    missingScopes: missing,
    needsScopeUpgrade: needsUpgrade,
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
  signal?: AbortSignal;
  executionId?: string;
  /** Opens Spotify desktop via Windows companion (at most once per recovery). */
  openSpotifyDesktop?: () => Promise<{ ok: boolean; message?: string }>;
  onActivity?: (label: string) => void;
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

    // At most one Windows open_application per play_* recovery sequence
    let openSpotifyPromise: Promise<{ ok: boolean; message?: string }> | null =
      null;
    const openSpotifyOnce = opts.openSpotifyDesktop
      ? () => {
          if (!openSpotifyPromise) {
            openSpotifyPromise = opts.openSpotifyDesktop!();
          }
          return openSpotifyPromise;
        }
      : undefined;

    const recoverDevice = async (
      preferredDeviceId?: string,
    ): Promise<
      | { ok: true; deviceId: string }
      | { ok: false; result: ToolResult }
    > => {
      if (preferredDeviceId) {
        return { ok: true, deviceId: preferredDeviceId };
      }

      const recovery = await ensureSpotifyPlaybackDevice({
        getDevices: async () => {
          const devices = await adapter.getDevices();
          return devices.map(
            (d): RecoverableDevice => ({
              id: d.id,
              name: d.name,
              type: d.type,
              isActive: d.isActive,
              isRestricted: d.isRestricted,
            }),
          );
        },
        openSpotifyDesktop: openSpotifyOnce,
        transferPlayback: (deviceId, play) =>
          adapter.transferPlayback(deviceId, play),
        signal: opts.signal,
        onActivity: opts.onActivity,
      });

      if (!recovery.ok) {
        if (recovery.cancelled) {
          return {
            ok: false,
            result: {
              success: false,
              error: { code: "CANCELLED", message: "Cancelled." },
              activityLabel: "Cancelled",
            },
          };
        }
        return {
          ok: false,
          result: {
            success: false,
            error: {
              code: "NO_ACTIVE_DEVICE",
              message: recovery.message,
            },
            activityLabel: "Waiting for Spotify",
            data: {
              openedSpotify: recovery.openedSpotify,
              recoveryFailed: true,
            },
          },
        };
      }

      return { ok: true, deviceId: recovery.deviceId };
    };

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
          typeof opts.input.limit === "number" ? opts.input.limit : 10;
        return resolveTrackSearch({
          supabase: opts.supabase,
          userId: opts.userId,
          conversationId: opts.conversationId,
          adapter,
          query,
          artist,
          limit,
        });
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

        if (!deviceId) {
          const ready = await recoverDevice();
          if (!ready.ok) return ready.result;
          deviceId = ready.deviceId;
        }

        opts.onActivity?.("Starting playback…");
        try {
          await adapter.play({ uris: [trackRef.provider_uri], deviceId });
        } catch (err) {
          if (
            err instanceof SpotifyApiError &&
            err.code === "NO_ACTIVE_DEVICE"
          ) {
            const ready = await recoverDevice();
            if (!ready.ok) return ready.result;
            deviceId = ready.deviceId;
            await adapter.play({
              uris: [trackRef.provider_uri],
              deviceId,
            });
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

        // Learn when this play resolves an open disambiguation session
        const session = await getActiveDisambiguationSession({
          supabase: opts.supabase,
          userId: opts.userId,
          conversationId: opts.conversationId,
        });
        if (
          session &&
          session.intent_type === "track" &&
          session.candidates.some((c) => c.providerId === trackRef.provider_id)
        ) {
          await markDisambiguationResolved({
            supabase: opts.supabase,
            userId: opts.userId,
            sessionId: session.id,
            selectedProviderId: trackRef.provider_id,
          });
          await learnFromSuccessfulPlay({
            supabase: opts.supabase,
            userId: opts.userId,
            conversationId: opts.conversationId,
            kind: "track",
            providerId: trackRef.provider_id,
            providerUri: trackRef.provider_uri,
            name: trackRef.label,
            artists: trackRef.subtitle ?? undefined,
            explicit: Boolean(
              (trackRef.payload as { explicit?: boolean } | null)?.explicit,
            ),
            normalizedQuery: session.normalized_query,
            source: "USER_SELECTED",
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
        const result = await runVerifiedPlayPauseMutation({
          action: "pause",
          getState: async () =>
            snapshotFromPlayback(await adapter.getPlaybackState()),
          mutate: (deviceId) => adapter.pause(deviceId),
          ensureDevice: () => recoverDevice(),
          signal: opts.signal,
          executionId: opts.executionId,
          log: (event) => console.info("[aurum:spotify]", event),
        });
        if (result.success && opts.conversationId) {
          setMediaContext(opts.conversationId, { isPlaying: false });
        }
        return result;
      }

      case "resume": {
        const result = await runVerifiedPlayPauseMutation({
          action: "resume",
          getState: async () =>
            snapshotFromPlayback(await adapter.getPlaybackState()),
          mutate: (deviceId) => adapter.resume(deviceId),
          ensureDevice: () => recoverDevice(),
          signal: opts.signal,
          executionId: opts.executionId,
          log: (event) => console.info("[aurum:spotify]", event),
        });
        if (result.success && opts.conversationId) {
          setMediaContext(opts.conversationId, { isPlaying: true });
        }
        return result;
      }

      case "next": {
        const result = await runVerifiedSkipMutation({
          direction: "next",
          getState: async () =>
            snapshotFromPlayback(await adapter.getPlaybackState()),
          mutate: (deviceId) => adapter.next(deviceId),
          ensureDevice: () => recoverDevice(),
          signal: opts.signal,
          executionId: opts.executionId,
          log: (event) => console.info("[aurum:spotify]", event),
        });
        if (result.success && opts.conversationId) {
          const current = (result.data as { currentTrack?: { name?: string | null; artists?: string[] } } | undefined)
            ?.currentTrack;
          if (current?.name) {
            setMediaContext(opts.conversationId, {
              isPlaying: true,
              trackLabel: current.name ?? undefined,
              artistLabel: current.artists?.join(", ") || undefined,
            });
          } else {
            setMediaContext(opts.conversationId, { isPlaying: true });
          }
        }
        return result;
      }

      case "previous": {
        const result = await runVerifiedSkipMutation({
          direction: "previous",
          getState: async () =>
            snapshotFromPlayback(await adapter.getPlaybackState()),
          mutate: (deviceId) => adapter.previous(deviceId),
          ensureDevice: () => recoverDevice(),
          signal: opts.signal,
          executionId: opts.executionId,
          log: (event) => console.info("[aurum:spotify]", event),
        });
        if (result.success && opts.conversationId) {
          const current = (result.data as { currentTrack?: { name?: string | null; artists?: string[] } } | undefined)
            ?.currentTrack;
          if (current?.name) {
            setMediaContext(opts.conversationId, {
              isPlaying: true,
              trackLabel: current.name ?? undefined,
              artistLabel: current.artists?.join(", ") || undefined,
            });
          } else {
            setMediaContext(opts.conversationId, { isPlaying: true });
          }
        }
        return result;
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

      case "search_tracks": {
        // Alias of search_track with higher default limit for playlist building
        return runSpotifyTool({
          ...opts,
          action: "search_track",
          input: {
            ...opts.input,
            limit:
              typeof opts.input.limit === "number" ? opts.input.limit : 20,
          },
        });
      }

      case "get_queue": {
        const queue = await adapter.getQueue();
        return {
          success: true,
          data: {
            currentlyPlaying: queue.currentlyPlaying
              ? {
                  name: queue.currentlyPlaying.name,
                  artists: queue.currentlyPlaying.artists,
                }
              : null,
            queue: queue.queue.slice(0, 20).map((t) => ({
              name: t.name,
              artists: t.artists,
            })),
          },
          message: `Queue has ${queue.queue.length} upcoming track(s).`,
          activityLabel: "Checked queue",
        };
      }

      case "get_user_playlists": {
        const limit =
          typeof opts.input.limit === "number" ? opts.input.limit : 100;
        const playlists = await adapter.getUserPlaylists(limit);
        const items = [];
        for (const p of playlists) {
          const ref = await createIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            provider: "spotify",
            kind: "playlist",
            providerId: p.id,
            providerUri: p.uri,
            label: p.name,
            subtitle: p.public ? "Public" : "Private",
            payload: { ownerId: p.ownerId },
            conversationId: opts.conversationId,
          });
          items.push({
            referenceId: ref.id,
            name: p.name,
            public: p.public,
            ownerId: p.ownerId,
          });
        }
        return {
          success: true,
          data: { playlists: items },
          message: `Found ${items.length} playlist(s).`,
          activityLabel: "Listed playlists",
        };
      }

      case "get_playlist": {
        const pref = await resolveIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          referenceId: opts.input.playlistReference,
          provider: "spotify",
          kind: "playlist",
        });
        if (!pref) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "Invalid or expired playlist reference.",
            },
          };
        }
        const playlist = await adapter.getPlaylist(pref.provider_id);
        return {
          success: true,
          data: {
            referenceId: pref.id,
            name: playlist.name,
            description: playlist.description,
            public: playlist.public,
            tracksTotal: playlist.tracksTotal,
          },
          message: playlist.name,
          activityLabel: `Loaded · ${playlist.name}`,
        };
      }

      case "get_playlist_items": {
        const pref = await resolveIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          referenceId: opts.input.playlistReference,
          provider: "spotify",
          kind: "playlist",
        });
        if (!pref) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "Invalid or expired playlist reference.",
            },
          };
        }
        const limit =
          typeof opts.input.limit === "number" ? opts.input.limit : 50;
        const hits = await adapter.getPlaylistItems(pref.provider_id, limit);
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
            conversationId: opts.conversationId,
          });
          tracks.push({
            referenceId: ref.id,
            name: t.name,
            artists: t.artists,
          });
        }
        return {
          success: true,
          data: { tracks, playlist: pref.label },
          message: `${tracks.length} track(s) in ${pref.label}.`,
          activityLabel: "Loaded playlist tracks",
        };
      }

      case "search_albums": {
        const query = String(opts.input.query ?? "").trim();
        if (!query) {
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Query required." },
          };
        }
        const hits = await adapter.searchAlbums({
          query,
          limit: typeof opts.input.limit === "number" ? opts.input.limit : 5,
        });
        const albums = [];
        for (const a of hits) {
          const ref = await createIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            provider: "spotify",
            kind: "album",
            providerId: a.id,
            providerUri: a.uri,
            label: a.name,
            subtitle: a.artists.join(", "),
            conversationId: opts.conversationId,
          });
          albums.push({
            referenceId: ref.id,
            name: a.name,
            artists: a.artists,
          });
        }
        return {
          success: true,
          data: { albums },
          message: `Found ${albums.length} album(s).`,
          activityLabel: "Searched albums",
        };
      }

      case "search_artists": {
        const query = String(opts.input.query ?? "").trim();
        if (!query) {
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Query required." },
          };
        }
        const hits = await adapter.searchArtists({
          query,
          limit: typeof opts.input.limit === "number" ? opts.input.limit : 5,
        });
        // Artists are returned as labels for further track searches — no mutation URI path
        return {
          success: true,
          data: {
            artists: hits.map((a) => ({ name: a.name, idHint: a.id })),
          },
          message: `Found ${hits.length} artist(s).`,
          activityLabel: "Searched artists",
        };
      }

      case "resolve_playlist": {
        return resolveUserPlaylist({
          supabase: opts.supabase,
          userId: opts.userId,
          conversationId: opts.conversationId,
          adapter,
          query: String(opts.input.query ?? ""),
          mineOnly:
            typeof opts.input.mineOnly === "boolean"
              ? opts.input.mineOnly
              : true,
        });
      }

      case "resolve_disambiguation": {
        const choice = String(opts.input.choice ?? "").trim();
        if (!choice) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Choice text is required.",
            },
          };
        }
        const session = await getActiveDisambiguationSession({
          supabase: opts.supabase,
          userId: opts.userId,
          conversationId: opts.conversationId,
        });
        if (!session) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message:
                "No active clarification to resolve. Search again, then ask.",
            },
            activityLabel: "No clarification pending",
          };
        }
        const picked = resolveChoiceAgainstCandidates(
          choice,
          session.candidates,
        );
        if (!picked) {
          return {
            success: false,
            error: {
              code:
                session.intent_type === "playlist"
                  ? "AMBIGUOUS_PLAYLIST"
                  : "AMBIGUOUS_TRACK",
              message: "Could not match that answer to a candidate — ask again.",
            },
            data: {
              candidates: session.candidates.map((c) => ({
                name: c.name,
                artists: c.artists,
                playlistName: c.playlistName,
              })),
            },
          };
        }

        const temporary = opts.input.temporary === true;
        const persist = opts.input.persist === true;
        const source = persist
          ? "USER_EXPLICITLY_PREFERRED"
          : "USER_SELECTED";

        const kind = session.intent_type === "playlist" ? "playlist" : "track";
        const ref = await createIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          provider: "spotify",
          kind,
          providerId: picked.providerId,
          providerUri: picked.providerUri,
          label: picked.name,
          subtitle:
            picked.artists?.join(", ") ??
            picked.playlistName ??
            null,
          payload: {
            artists: picked.artists,
            album: picked.album,
            explicit: picked.explicit,
            fromDisambiguation: true,
          },
          conversationId: opts.conversationId,
        });

        await markDisambiguationResolved({
          supabase: opts.supabase,
          userId: opts.userId,
          sessionId: session.id,
          selectedProviderId: picked.providerId,
        });

        if (!temporary || persist) {
          await upsertMusicPreference({
            supabase: opts.supabase,
            userId: opts.userId,
            input: {
              intentType: kind,
              normalizedQuery: session.normalized_query,
              spotifyResourceType: kind,
              spotifyResourceId: picked.providerId,
              spotifyResourceUri: picked.providerUri,
              trackName: kind === "track" ? picked.name : null,
              artistName: picked.artists?.join(", ") ?? null,
              albumName: picked.album ?? null,
              playlistName: kind === "playlist" ? picked.name : null,
              explicit: picked.explicit ?? null,
              source,
            },
          });
        }

        if (kind === "track") {
          return {
            success: true,
            data: {
              tracks: [
                {
                  referenceId: ref.id,
                  name: picked.name,
                  artists: picked.artists ?? [],
                  album: picked.album,
                  explicit: picked.explicit,
                },
              ],
              referenceId: ref.id,
              kind,
              persisted: !temporary || persist,
            },
            message: `Selected ${picked.name}${
              picked.artists?.length
                ? ` — ${picked.artists.join(", ")}`
                : ""
            }.`,
            activityLabel: `Selected · ${picked.name}`,
          };
        }

        return {
          success: true,
          data: {
            playlists: [
              {
                referenceId: ref.id,
                name: picked.name,
              },
            ],
            referenceId: ref.id,
            kind,
            persisted: !temporary || persist,
          },
          message: `Selected playlist ${picked.name}.`,
          activityLabel: `Selected · ${picked.name}`,
        };
      }

      case "list_music_preferences": {
        const rows = await listMusicPreferences({
          supabase: opts.supabase,
          userId: opts.userId,
          intentType:
            opts.input.intentType === "track" ||
            opts.input.intentType === "playlist" ||
            opts.input.intentType === "album"
              ? opts.input.intentType
              : undefined,
          limit:
            typeof opts.input.limit === "number" ? opts.input.limit : 50,
        });
        return {
          success: true,
          data: {
            preferences: rows.map((r) => ({
              preferenceId: r.id,
              intentType: r.intent_type,
              query: r.normalized_query,
              name: r.track_name ?? r.playlist_name ?? r.album_name,
              artists: r.artist_name,
              explicit: r.explicit,
              source: r.source,
              useCount: r.use_count,
              lastUsedAt: r.last_used_at,
              stale: r.stale,
            })),
          },
          message:
            rows.length === 0
              ? "No remembered music preferences."
              : `${rows.length} remembered preference(s).`,
          activityLabel: "Listed music memory",
        };
      }

      case "forget_music_preference": {
        if (typeof opts.input.preferenceId === "string") {
          const ok = await deleteMusicPreference({
            supabase: opts.supabase,
            userId: opts.userId,
            preferenceId: opts.input.preferenceId,
          });
          return {
            success: ok,
            message: ok ? "Forgot that preference." : "Preference not found.",
            activityLabel: "Updated music memory",
          };
        }
        const query = String(opts.input.query ?? "").trim();
        if (!query) {
          // clear all when neither id nor query — require intent or refuse
          if (opts.input.intentType) {
            const n = await clearMusicPreferences({
              supabase: opts.supabase,
              userId: opts.userId,
              intentType: opts.input.intentType as
                | "track"
                | "playlist"
                | "album",
            });
            return {
              success: true,
              message: `Cleared ${n} preference(s).`,
              activityLabel: "Updated music memory",
            };
          }
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Provide preferenceId or query to forget.",
            },
          };
        }
        const normalized = normalizeMusicQuery(query);
        const intent =
          opts.input.intentType === "playlist" ||
          opts.input.intentType === "album"
            ? opts.input.intentType
            : "track";
        const ok = await forgetMusicPreferenceByQuery({
          supabase: opts.supabase,
          userId: opts.userId,
          intentType: intent,
          normalizedQuery: normalized.key,
        });
        return {
          success: ok,
          message: ok
            ? `Forgot preference for “${normalized.key}”.`
            : "Preference not found.",
          activityLabel: "Updated music memory",
        };
      }

      case "remember_music_preference": {
        const query = String(opts.input.query ?? "").trim();
        if (!query) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Query phrase is required.",
            },
          };
        }
        const normalized = normalizeMusicQuery(query);
        if (opts.input.trackReference) {
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
                message: "Invalid or expired track reference.",
              },
            };
          }
          await upsertMusicPreference({
            supabase: opts.supabase,
            userId: opts.userId,
            input: {
              intentType: "track",
              normalizedQuery: normalized.key,
              spotifyResourceType: "track",
              spotifyResourceId: trackRef.provider_id,
              spotifyResourceUri: trackRef.provider_uri,
              trackName: trackRef.label,
              artistName: trackRef.subtitle,
              explicit: Boolean(
                (trackRef.payload as { explicit?: boolean } | null)?.explicit,
              ),
              source: "USER_EXPLICITLY_PREFERRED",
            },
          });
          return {
            success: true,
            message: `I'll use ${trackRef.label} when you say “${normalized.key}”.`,
            activityLabel: "Saved music memory",
          };
        }
        if (opts.input.playlistReference) {
          const pref = await resolveIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            referenceId: opts.input.playlistReference,
            provider: "spotify",
            kind: "playlist",
          });
          if (!pref) {
            return {
              success: false,
              error: {
                code: "NOT_FOUND",
                message: "Invalid or expired playlist reference.",
              },
            };
          }
          await upsertMusicPreference({
            supabase: opts.supabase,
            userId: opts.userId,
            input: {
              intentType: "playlist",
              normalizedQuery: normalized.key,
              spotifyResourceType: "playlist",
              spotifyResourceId: pref.provider_id,
              spotifyResourceUri: pref.provider_uri,
              playlistName: pref.label,
              source: "USER_EXPLICITLY_PREFERRED",
            },
          });
          return {
            success: true,
            message: `I'll use playlist ${pref.label} when you say “${normalized.key}”.`,
            activityLabel: "Saved music memory",
          };
        }
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Provide trackReference or playlistReference.",
          },
        };
      }

      case "play_album":
      case "play_playlist": {
        const kind = opts.action === "play_album" ? "album" : "playlist";
        const cref = await resolveIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          referenceId: opts.input.contextReference,
          provider: "spotify",
          kind,
        });
        if (!cref) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Invalid or expired ${kind} reference.`,
            },
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
          deviceId = deviceRef?.provider_id;
        }

        if (!deviceId) {
          const ready = await recoverDevice();
          if (!ready.ok) return ready.result;
          deviceId = ready.deviceId;
        }

        opts.onActivity?.(
          kind === "playlist" ? "Starting playlist…" : "Starting album…",
        );
        try {
          await adapter.playContext({
            contextUri: cref.provider_uri,
            deviceId,
          });
        } catch (err) {
          if (
            err instanceof SpotifyApiError &&
            err.code === "NO_ACTIVE_DEVICE"
          ) {
            const ready = await recoverDevice();
            if (!ready.ok) return ready.result;
            deviceId = ready.deviceId;
            await adapter.playContext({
              contextUri: cref.provider_uri,
              deviceId,
            });
          } else {
            throw err;
          }
        }

        if (opts.conversationId) {
          setMediaContext(opts.conversationId, {
            trackLabel: cref.label,
            isPlaying: true,
          });
        }

        if (kind === "playlist") {
          // Playlist playback must not leave stale TRACK clarification active.
          await expireActiveDisambiguationSessions({
            supabase: opts.supabase,
            userId: opts.userId,
            conversationId: opts.conversationId,
            intentType: "track",
          });
          const session = await getActiveDisambiguationSession({
            supabase: opts.supabase,
            userId: opts.userId,
            conversationId: opts.conversationId,
          });
          if (
            session &&
            session.intent_type === "playlist" &&
            session.candidates.some((c) => c.providerId === cref.provider_id)
          ) {
            await markDisambiguationResolved({
              supabase: opts.supabase,
              userId: opts.userId,
              sessionId: session.id,
              selectedProviderId: cref.provider_id,
            });
            await learnFromSuccessfulPlay({
              supabase: opts.supabase,
              userId: opts.userId,
              conversationId: opts.conversationId,
              kind: "playlist",
              providerId: cref.provider_id,
              providerUri: cref.provider_uri,
              name: cref.label,
              normalizedQuery: session.normalized_query,
              source: "USER_SELECTED",
            });
          }
        }

        return {
          success: true,
          data: {
            name: cref.label,
            kind,
            resourceType: kind,
            referenceId: cref.id,
          },
          message: `Playing ${cref.label} on Spotify.`,
          activityLabel: `Playing · ${cref.label}`,
        };
      }

      case "set_shuffle": {
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
        const enabled = Boolean(opts.input.enabled);
        await adapter.setShuffle(enabled, deviceId);
        return {
          success: true,
          data: { enabled },
          message: enabled ? "Shuffle on." : "Shuffle off.",
          activityLabel: enabled ? "Shuffle on" : "Shuffle off",
        };
      }

      case "set_repeat": {
        const state = opts.input.state as "off" | "track" | "context";
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
        await adapter.setRepeat(state, deviceId);
        return {
          success: true,
          data: { state },
          message: `Repeat set to ${state}.`,
          activityLabel: "Repeat updated",
        };
      }

      case "transfer_playback": {
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
          };
        }
        await adapter.transferPlayback(
          deviceRef.provider_id,
          Boolean(opts.input.play),
        );
        return {
          success: true,
          message: `Playback transferred to ${deviceRef.label}.`,
          activityLabel: `Transfer · ${deviceRef.label}`,
        };
      }

      case "add_to_queue": {
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
              message: "Invalid or expired track reference.",
            },
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
          deviceId = deviceRef?.provider_id;
        }
        await adapter.addToQueue(trackRef.provider_uri, deviceId);
        return {
          success: true,
          message: `Queued ${trackRef.label}.`,
          activityLabel: "Added to queue",
        };
      }

      case "save_item": {
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
              message: "Invalid or expired track reference.",
            },
          };
        }
        await adapter.saveTracks([trackRef.provider_id]);
        return {
          success: true,
          message: `Saved ${trackRef.label}.`,
          activityLabel: "Saved track",
        };
      }

      case "remove_saved_item": {
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
              message: "Invalid or expired track reference.",
            },
          };
        }
        await adapter.removeSavedTracks([trackRef.provider_id]);
        return {
          success: true,
          message: `Removed ${trackRef.label} from Liked Songs.`,
          activityLabel: "Removed saved track",
        };
      }

      case "check_saved_item": {
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
              message: "Invalid or expired track reference.",
            },
          };
        }
        const [saved] = await adapter.checkSavedTracks([trackRef.provider_id]);
        return {
          success: true,
          data: { saved: Boolean(saved), track: trackRef.label },
          message: saved ? "Track is saved." : "Track is not saved.",
          activityLabel: "Checked library",
        };
      }

      case "create_playlist": {
        const name = String(opts.input.name ?? "").trim();
        if (!name) {
          return {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Playlist name required." },
          };
        }
        const userId = await adapter.getCurrentUserId();
        const created = await adapter.createPlaylist({
          userId,
          name,
          description:
            typeof opts.input.description === "string"
              ? opts.input.description
              : undefined,
          isPublic: Boolean(opts.input.public),
        });
        const ref = await createIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          provider: "spotify",
          kind: "playlist",
          providerId: created.id,
          providerUri: created.uri,
          label: created.name,
          subtitle: opts.input.public ? "Public" : "Private",
          conversationId: opts.conversationId,
        });
        return {
          success: true,
          data: { referenceId: ref.id, name: created.name },
          message: `Created playlist ${created.name}.`,
          activityLabel: `Creating playlist · ${created.name}`,
        };
      }

      case "rename_playlist":
      case "change_playlist_description":
      case "change_playlist_visibility": {
        const pref = await resolveIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          referenceId: opts.input.playlistReference,
          provider: "spotify",
          kind: "playlist",
        });
        if (!pref) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "Invalid or expired playlist reference.",
            },
          };
        }
        const patch: {
          name?: string;
          description?: string;
          public?: boolean;
        } = {};
        if (opts.action === "rename_playlist") {
          patch.name = String(opts.input.name ?? "").trim();
        } else if (opts.action === "change_playlist_description") {
          patch.description = String(opts.input.description ?? "");
        } else {
          patch.public = Boolean(opts.input.public);
        }
        await adapter.changePlaylistDetails(pref.provider_id, patch);
        return {
          success: true,
          message: `Updated playlist ${pref.label}.`,
          activityLabel: "Playlist updated",
        };
      }

      case "add_playlist_items":
      case "remove_playlist_items": {
        const pref = await resolveIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          referenceId: opts.input.playlistReference,
          provider: "spotify",
          kind: "playlist",
        });
        if (!pref) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "Invalid or expired playlist reference.",
            },
          };
        }
        const refs = Array.isArray(opts.input.trackReferences)
          ? opts.input.trackReferences
          : [];
        const uris: string[] = [];
        for (const id of refs) {
          const tref = await resolveIntegrationReference({
            supabase: opts.supabase,
            userId: opts.userId,
            referenceId: id,
            provider: "spotify",
            kind: "track",
          });
          if (tref) uris.push(tref.provider_uri);
        }
        if (uris.length === 0) {
          return {
            success: false,
            error: {
              code: "TRACK_NOT_FOUND",
              message: "No valid trusted track references.",
            },
          };
        }
        if (opts.action === "add_playlist_items") {
          await adapter.addPlaylistItems(pref.provider_id, uris);
          return {
            success: true,
            data: { added: uris.length },
            message: `Added ${uris.length} track(s) to ${pref.label}.`,
            activityLabel: `Adding ${uris.length} tracks`,
          };
        }
        await adapter.removePlaylistItems(pref.provider_id, uris);
        return {
          success: true,
          data: { removed: uris.length },
          message: `Removed ${uris.length} track(s) from ${pref.label}.`,
          activityLabel: `Removing ${uris.length} tracks`,
        };
      }

      case "reorder_playlist_items": {
        const pref = await resolveIntegrationReference({
          supabase: opts.supabase,
          userId: opts.userId,
          referenceId: opts.input.playlistReference,
          provider: "spotify",
          kind: "playlist",
        });
        if (!pref) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "Invalid or expired playlist reference.",
            },
          };
        }
        await adapter.reorderPlaylistItems({
          playlistId: pref.provider_id,
          rangeStart: Number(opts.input.rangeStart),
          insertBefore: Number(opts.input.insertBefore),
          rangeLength:
            typeof opts.input.rangeLength === "number"
              ? opts.input.rangeLength
              : undefined,
        });
        return {
          success: true,
          message: `Reordered ${pref.label}.`,
          activityLabel: "Reordered playlist",
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

export { SPOTIFY_SCOPES, isSpotifyConfigured, needsSpotifyScopeUpgrade };
