import type { ToolErrorCode } from "@aurum/tools";

const SPOTIFY_API = "https://api.spotify.com/v1";

export type SpotifyTrackHit = {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
};

export type SpotifyDeviceHit = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
};

export type SpotifyPlaybackState = {
  isPlaying: boolean;
  progressMs: number | null;
  volumePercent: number | null;
  device: SpotifyDeviceHit | null;
  track: {
    id: string;
    uri: string;
    name: string;
    artists: string[];
    album: string;
    durationMs: number;
  } | null;
};

export class SpotifyApiError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

function mapHttpError(status: number, bodyText: string): SpotifyApiError {
  // Never include raw body tokens; sanitize message only
  const lower = bodyText.toLowerCase();
  if (status === 401) {
    return new SpotifyApiError("TOKEN_EXPIRED", "Spotify authorization expired.", status);
  }
  if (status === 403) {
    if (lower.includes("premium")) {
      return new SpotifyApiError(
        "PREMIUM_REQUIRED",
        "Spotify Premium is required for playback control.",
        status,
      );
    }
    return new SpotifyApiError(
      "PERMISSION_DENIED",
      "Spotify rejected this action.",
      status,
    );
  }
  if (status === 404) {
    if (lower.includes("device") || lower.includes("player")) {
      return new SpotifyApiError(
        "NO_ACTIVE_DEVICE",
        "No active Spotify playback device.",
        status,
      );
    }
    return new SpotifyApiError("NOT_FOUND", "Spotify resource not found.", status);
  }
  if (status === 429) {
    return new SpotifyApiError(
      "RATE_LIMITED",
      "Spotify rate limit reached. Try again shortly.",
      status,
    );
  }
  if (status >= 500) {
    return new SpotifyApiError(
      "PROVIDER_UNAVAILABLE",
      "Spotify is temporarily unavailable.",
      status,
    );
  }
  return new SpotifyApiError(
    "EXECUTION_FAILED",
    "Spotify request failed.",
    status,
  );
}

async function spotifyFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok || res.status === 204) return;
  const text = await res.text().catch(() => "");
  throw mapHttpError(res.status, text.slice(0, 400));
}

export class SpotifyAdapter {
  constructor(private readonly accessToken: string) {}

  async searchTracks(opts: {
    query: string;
    artist?: string;
    limit?: number;
  }): Promise<SpotifyTrackHit[]> {
    const q = opts.artist
      ? `track:${opts.query} artist:${opts.artist}`
      : opts.query;
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
    const params = new URLSearchParams({
      q,
      type: "track",
      limit: String(limit),
    });
    const res = await spotifyFetch(
      this.accessToken,
      `/search?${params.toString()}`,
    );
    await assertOk(res);
    const json = (await res.json()) as {
      tracks?: {
        items?: Array<{
          id: string;
          uri: string;
          name: string;
          duration_ms: number;
          artists?: Array<{ name: string }>;
          album?: { name: string };
        }>;
      };
    };
    return (json.tracks?.items ?? []).map((t) => ({
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: (t.artists ?? []).map((a) => a.name),
      album: t.album?.name ?? "",
      durationMs: t.duration_ms,
    }));
  }

  async getPlaybackState(): Promise<SpotifyPlaybackState | null> {
    const res = await spotifyFetch(this.accessToken, "/me/player");
    if (res.status === 204) return null;
    await assertOk(res);
    const json = (await res.json()) as {
      is_playing?: boolean;
      progress_ms?: number;
      device?: {
        id: string;
        name: string;
        type: string;
        is_active: boolean;
        is_restricted: boolean;
        volume_percent: number | null;
      };
      item?: {
        id: string;
        uri: string;
        name: string;
        duration_ms: number;
        artists?: Array<{ name: string }>;
        album?: { name: string };
      } | null;
    };
    return {
      isPlaying: Boolean(json.is_playing),
      progressMs: json.progress_ms ?? null,
      volumePercent: json.device?.volume_percent ?? null,
      device: json.device
        ? {
            id: json.device.id,
            name: json.device.name,
            type: json.device.type,
            isActive: json.device.is_active,
            isRestricted: json.device.is_restricted,
            volumePercent: json.device.volume_percent,
          }
        : null,
      track: json.item
        ? {
            id: json.item.id,
            uri: json.item.uri,
            name: json.item.name,
            artists: (json.item.artists ?? []).map((a) => a.name),
            album: json.item.album?.name ?? "",
            durationMs: json.item.duration_ms,
          }
        : null,
    };
  }

  async getDevices(): Promise<SpotifyDeviceHit[]> {
    const res = await spotifyFetch(this.accessToken, "/me/player/devices");
    await assertOk(res);
    const json = (await res.json()) as {
      devices?: Array<{
        id: string;
        name: string;
        type: string;
        is_active: boolean;
        is_restricted: boolean;
        volume_percent: number | null;
      }>;
    };
    return (json.devices ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      isActive: d.is_active,
      isRestricted: d.is_restricted,
      volumePercent: d.volume_percent,
    }));
  }

  async play(opts: { uris?: string[]; deviceId?: string }): Promise<void> {
    const qs = opts.deviceId
      ? `?device_id=${encodeURIComponent(opts.deviceId)}`
      : "";
    const body =
      opts.uris && opts.uris.length > 0
        ? JSON.stringify({ uris: opts.uris })
        : undefined;
    const res = await spotifyFetch(this.accessToken, `/me/player/play${qs}`, {
      method: "PUT",
      body,
    });
    await assertOk(res);
  }

  async pause(deviceId?: string): Promise<void> {
    const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    const res = await spotifyFetch(this.accessToken, `/me/player/pause${qs}`, {
      method: "PUT",
    });
    await assertOk(res);
  }

  async resume(deviceId?: string): Promise<void> {
    await this.play({ deviceId });
  }

  async next(deviceId?: string): Promise<void> {
    const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    const res = await spotifyFetch(this.accessToken, `/me/player/next${qs}`, {
      method: "POST",
    });
    await assertOk(res);
  }

  async previous(deviceId?: string): Promise<void> {
    const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    const res = await spotifyFetch(
      this.accessToken,
      `/me/player/previous${qs}`,
      { method: "POST" },
    );
    await assertOk(res);
  }

  async setVolume(percent: number, deviceId?: string): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    const params = new URLSearchParams({
      volume_percent: String(clamped),
    });
    if (deviceId) params.set("device_id", deviceId);
    const res = await spotifyFetch(
      this.accessToken,
      `/me/player/volume?${params.toString()}`,
      { method: "PUT" },
    );
    await assertOk(res);
  }

  async playContext(opts: {
    contextUri: string;
    deviceId?: string;
  }): Promise<void> {
    const qs = opts.deviceId
      ? `?device_id=${encodeURIComponent(opts.deviceId)}`
      : "";
    const res = await spotifyFetch(this.accessToken, `/me/player/play${qs}`, {
      method: "PUT",
      body: JSON.stringify({ context_uri: opts.contextUri }),
    });
    await assertOk(res);
  }

  async getQueue(): Promise<{
    currentlyPlaying: SpotifyTrackHit | null;
    queue: SpotifyTrackHit[];
  }> {
    const res = await spotifyFetch(this.accessToken, "/me/player/queue");
    await assertOk(res);
    const json = (await res.json()) as {
      currently_playing?: {
        id?: string;
        uri?: string;
        name?: string;
        duration_ms?: number;
        artists?: Array<{ name: string }>;
        album?: { name: string };
      } | null;
      queue?: Array<{
        id: string;
        uri: string;
        name: string;
        duration_ms: number;
        artists?: Array<{ name: string }>;
        album?: { name: string };
      }>;
    };
    const mapTrack = (t: {
      id?: string;
      uri?: string;
      name?: string;
      duration_ms?: number;
      artists?: Array<{ name: string }>;
      album?: { name: string };
    } | null | undefined): SpotifyTrackHit | null => {
      if (!t?.id || !t.uri || !t.name) return null;
      return {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: (t.artists ?? []).map((a) => a.name),
        album: t.album?.name ?? "",
        durationMs: t.duration_ms ?? 0,
      };
    };
    return {
      currentlyPlaying: mapTrack(json.currently_playing),
      queue: (json.queue ?? [])
        .map((t) => mapTrack(t))
        .filter((t): t is SpotifyTrackHit => Boolean(t)),
    };
  }

  async searchAlbums(opts: {
    query: string;
    limit?: number;
  }): Promise<Array<{ id: string; uri: string; name: string; artists: string[] }>> {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
    const params = new URLSearchParams({
      q: opts.query,
      type: "album",
      limit: String(limit),
    });
    const res = await spotifyFetch(
      this.accessToken,
      `/search?${params.toString()}`,
    );
    await assertOk(res);
    const json = (await res.json()) as {
      albums?: {
        items?: Array<{
          id: string;
          uri: string;
          name: string;
          artists?: Array<{ name: string }>;
        }>;
      };
    };
    return (json.albums?.items ?? []).map((a) => ({
      id: a.id,
      uri: a.uri,
      name: a.name,
      artists: (a.artists ?? []).map((x) => x.name),
    }));
  }

  async searchArtists(opts: {
    query: string;
    limit?: number;
  }): Promise<Array<{ id: string; uri: string; name: string }>> {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
    const params = new URLSearchParams({
      q: opts.query,
      type: "artist",
      limit: String(limit),
    });
    const res = await spotifyFetch(
      this.accessToken,
      `/search?${params.toString()}`,
    );
    await assertOk(res);
    const json = (await res.json()) as {
      artists?: {
        items?: Array<{ id: string; uri: string; name: string }>;
      };
    };
    return (json.artists?.items ?? []).map((a) => ({
      id: a.id,
      uri: a.uri,
      name: a.name,
    }));
  }

  async setShuffle(enabled: boolean, deviceId?: string): Promise<void> {
    const params = new URLSearchParams({ state: String(enabled) });
    if (deviceId) params.set("device_id", deviceId);
    const res = await spotifyFetch(
      this.accessToken,
      `/me/player/shuffle?${params.toString()}`,
      { method: "PUT" },
    );
    await assertOk(res);
  }

  async setRepeat(
    state: "off" | "track" | "context",
    deviceId?: string,
  ): Promise<void> {
    const params = new URLSearchParams({ state });
    if (deviceId) params.set("device_id", deviceId);
    const res = await spotifyFetch(
      this.accessToken,
      `/me/player/repeat?${params.toString()}`,
      { method: "PUT" },
    );
    await assertOk(res);
  }

  async transferPlayback(deviceId: string, play?: boolean): Promise<void> {
    const res = await spotifyFetch(this.accessToken, "/me/player", {
      method: "PUT",
      body: JSON.stringify({
        device_ids: [deviceId],
        play: play ?? false,
      }),
    });
    await assertOk(res);
  }

  async addToQueue(uri: string, deviceId?: string): Promise<void> {
    const params = new URLSearchParams({ uri });
    if (deviceId) params.set("device_id", deviceId);
    const res = await spotifyFetch(
      this.accessToken,
      `/me/player/queue?${params.toString()}`,
      { method: "POST" },
    );
    await assertOk(res);
  }

  async getUserPlaylists(limit = 20): Promise<
    Array<{ id: string; uri: string; name: string; public: boolean | null }>
  > {
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(limit, 1), 50)),
    });
    const res = await spotifyFetch(
      this.accessToken,
      `/me/playlists?${params.toString()}`,
    );
    await assertOk(res);
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        uri: string;
        name: string;
        public: boolean | null;
      }>;
    };
    return json.items ?? [];
  }

  async getPlaylist(playlistId: string): Promise<{
    id: string;
    uri: string;
    name: string;
    description: string | null;
    public: boolean | null;
    tracksTotal: number;
  }> {
    const res = await spotifyFetch(
      this.accessToken,
      `/playlists/${encodeURIComponent(playlistId)}`,
    );
    await assertOk(res);
    const json = (await res.json()) as {
      id: string;
      uri: string;
      name: string;
      description: string | null;
      public: boolean | null;
      tracks?: { total?: number };
    };
    return {
      id: json.id,
      uri: json.uri,
      name: json.name,
      description: json.description,
      public: json.public,
      tracksTotal: json.tracks?.total ?? 0,
    };
  }

  async getPlaylistItems(
    playlistId: string,
    limit = 50,
  ): Promise<SpotifyTrackHit[]> {
    const params = new URLSearchParams({
      limit: String(Math.min(Math.max(limit, 1), 100)),
      fields: "items(track(id,uri,name,duration_ms,artists(name),album(name)))",
    });
    const res = await spotifyFetch(
      this.accessToken,
      `/playlists/${encodeURIComponent(playlistId)}/tracks?${params.toString()}`,
    );
    await assertOk(res);
    const json = (await res.json()) as {
      items?: Array<{
        track?: {
          id?: string;
          uri?: string;
          name?: string;
          duration_ms?: number;
          artists?: Array<{ name: string }>;
          album?: { name: string };
        } | null;
      }>;
    };
    const out: SpotifyTrackHit[] = [];
    for (const item of json.items ?? []) {
      const t = item.track;
      if (!t?.id || !t.uri || !t.name) continue;
      out.push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: (t.artists ?? []).map((a) => a.name),
        album: t.album?.name ?? "",
        durationMs: t.duration_ms ?? 0,
      });
    }
    return out;
  }

  async createPlaylist(opts: {
    userId: string;
    name: string;
    description?: string;
    isPublic?: boolean;
  }): Promise<{ id: string; uri: string; name: string }> {
    const res = await spotifyFetch(
      this.accessToken,
      `/users/${encodeURIComponent(opts.userId)}/playlists`,
      {
        method: "POST",
        body: JSON.stringify({
          name: opts.name,
          description: opts.description ?? "",
          public: opts.isPublic ?? false,
        }),
      },
    );
    await assertOk(res);
    const json = (await res.json()) as {
      id: string;
      uri: string;
      name: string;
    };
    return json;
  }

  async changePlaylistDetails(
    playlistId: string,
    patch: { name?: string; description?: string; public?: boolean },
  ): Promise<void> {
    const res = await spotifyFetch(
      this.accessToken,
      `/playlists/${encodeURIComponent(playlistId)}`,
      { method: "PUT", body: JSON.stringify(patch) },
    );
    await assertOk(res);
  }

  async addPlaylistItems(playlistId: string, uris: string[]): Promise<void> {
    // Spotify accepts max 100 uris per request
    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      const res = await spotifyFetch(
        this.accessToken,
        `/playlists/${encodeURIComponent(playlistId)}/tracks`,
        { method: "POST", body: JSON.stringify({ uris: chunk }) },
      );
      await assertOk(res);
    }
  }

  async removePlaylistItems(playlistId: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      const res = await spotifyFetch(
        this.accessToken,
        `/playlists/${encodeURIComponent(playlistId)}/tracks`,
        {
          method: "DELETE",
          body: JSON.stringify({
            tracks: chunk.map((uri) => ({ uri })),
          }),
        },
      );
      await assertOk(res);
    }
  }

  async reorderPlaylistItems(opts: {
    playlistId: string;
    rangeStart: number;
    insertBefore: number;
    rangeLength?: number;
  }): Promise<void> {
    const body: Record<string, number> = {
      range_start: opts.rangeStart,
      insert_before: opts.insertBefore,
    };
    if (opts.rangeLength != null) body.range_length = opts.rangeLength;
    const res = await spotifyFetch(
      this.accessToken,
      `/playlists/${encodeURIComponent(opts.playlistId)}/tracks`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    await assertOk(res);
  }

  async saveTracks(ids: string[]): Promise<void> {
    const params = new URLSearchParams({ ids: ids.join(",") });
    const res = await spotifyFetch(
      this.accessToken,
      `/me/tracks?${params.toString()}`,
      { method: "PUT" },
    );
    await assertOk(res);
  }

  async removeSavedTracks(ids: string[]): Promise<void> {
    const params = new URLSearchParams({ ids: ids.join(",") });
    const res = await spotifyFetch(
      this.accessToken,
      `/me/tracks?${params.toString()}`,
      { method: "DELETE" },
    );
    await assertOk(res);
  }

  async checkSavedTracks(ids: string[]): Promise<boolean[]> {
    const params = new URLSearchParams({ ids: ids.join(",") });
    const res = await spotifyFetch(
      this.accessToken,
      `/me/tracks/contains?${params.toString()}`,
    );
    await assertOk(res);
    return (await res.json()) as boolean[];
  }

  async getCurrentUserId(): Promise<string> {
    const res = await spotifyFetch(this.accessToken, "/me");
    await assertOk(res);
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new SpotifyApiError("NOT_FOUND", "Spotify user not found.");
    return json.id;
  }
}
