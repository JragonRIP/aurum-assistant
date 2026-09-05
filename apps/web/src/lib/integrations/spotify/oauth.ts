import { createHash, randomBytes } from "node:crypto";

/** Spotify scopes for playback + library + playlist management */
export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-library-modify",
] as const;

export type SpotifyScope = (typeof SPOTIFY_SCOPES)[number];

export const SPOTIFY_SCOPES_STRING = SPOTIFY_SCOPES.join(" ");

/** Scopes required by Phase 4.2 that may be missing on older connections */
export function missingSpotifyScopes(granted: string[] | null | undefined): string[] {
  const set = new Set((granted ?? []).map((s) => s.trim()).filter(Boolean));
  return SPOTIFY_SCOPES.filter((s) => !set.has(s));
}

export function needsSpotifyScopeUpgrade(
  granted: string[] | null | undefined,
): boolean {
  return missingSpotifyScopes(granted).length > 0;
}
/**
 * Spotify no longer accepts `localhost` aliases for OAuth redirect URIs.
 * Local development must use 127.0.0.1 — must match Developer Dashboard exactly.
 */
export const DEFAULT_SPOTIFY_REDIRECT_URI =
  "http://127.0.0.1:3000/api/integrations/spotify/callback";

export type OAuthStatePayload = {
  provider: "spotify";
  userId: string;
  nonce: string;
  createdAt: number;
};

export function getSpotifyClientConfig() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? "";
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI?.trim() || DEFAULT_SPOTIFY_REDIRECT_URI;
  return { clientId, clientSecret, redirectUri };
}

export function isSpotifyConfigured(): boolean {
  const { clientId, clientSecret } = getSpotifyClientConfig();
  return Boolean(clientId && clientSecret);
}

/** PKCE code_verifier (43–128 chars) */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function generateOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildSpotifyAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri?: string;
}): string {
  const { clientId, redirectUri } = getSpotifyClientConfig();
  if (!clientId) throw new Error("SPOTIFY_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri ?? redirectUri,
    scope: SPOTIFY_SCOPES_STRING,
    state: opts.state,
    code_challenge_method: "S256",
    code_challenge: opts.codeChallenge,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/** Shape check for stored oauth state rows (testable without DB) */
export function isValidOAuthStateShape(row: {
  state?: unknown;
  code_verifier?: unknown;
  provider?: unknown;
  user_id?: unknown;
  expires_at?: unknown;
}): boolean {
  return (
    typeof row.state === "string" &&
    row.state.length >= 16 &&
    typeof row.code_verifier === "string" &&
    row.code_verifier.length >= 43 &&
    row.provider === "spotify" &&
    typeof row.user_id === "string" &&
    typeof row.expires_at === "string"
  );
}
