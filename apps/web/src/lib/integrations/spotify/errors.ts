/**
 * Typed Spotify API failure classification.
 * Never logs access/refresh tokens or Authorization headers.
 */
import type { ToolErrorCode } from "@aurum/tools";

export type SpotifyFailureCode =
  | "MISSING_SCOPE"
  | "PLAYLIST_NOT_WRITABLE"
  | "AUTH_REVOKED"
  | "TRACK_NOT_FOUND"
  | "SPOTIFY_REJECTED"
  | "TRANSIENT_FAILURE"
  | "PREMIUM_REQUIRED"
  | "TOKEN_EXPIRED"
  | "NOT_FOUND"
  | "NO_ACTIVE_DEVICE"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "EXECUTION_FAILED";

export type SpotifyErrorBody = {
  status: number | null;
  message: string;
};

export type ClassifySpotifyFailureOpts = {
  httpStatus: number;
  bodyText?: string;
  action?: string;
  playlistIdPresent?: boolean;
  playlistOwnerMatchesUser?: boolean | null;
  collaborative?: boolean | null;
  grantedScopes?: string[];
  requiredScopes?: string[];
};

export type ClassifiedSpotifyFailure = {
  code: SpotifyFailureCode;
  reconnectRequired: boolean;
  httpStatus: number;
  spotifyErrorStatus: number | null;
  spotifyErrorMessage: string;
  userMessage: string;
};

const TOKEN_LIKE =
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_LIKE =
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function sanitizeSpotifyErrorText(text: string): string {
  return text
    .replace(TOKEN_LIKE, "Bearer [redacted]")
    .replace(JWT_LIKE, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function parseSpotifyErrorBody(bodyText: string): SpotifyErrorBody {
  const raw = bodyText.trim();
  if (!raw) return { status: null, message: "" };
  try {
    const json = JSON.parse(raw) as {
      error?: { status?: number; message?: string } | string;
      error_description?: string;
    };
    if (typeof json.error === "string") {
      const msg = [json.error, json.error_description]
        .filter(Boolean)
        .join(": ");
      return { status: null, message: sanitizeSpotifyErrorText(msg) };
    }
    if (json.error && typeof json.error === "object") {
      return {
        status:
          typeof json.error.status === "number" ? json.error.status : null,
        message: sanitizeSpotifyErrorText(json.error.message ?? ""),
      };
    }
  } catch {
    /* not JSON */
  }
  return { status: null, message: sanitizeSpotifyErrorText(raw) };
}

export function userMessageForSpotifyCode(code: SpotifyFailureCode): string {
  switch (code) {
    case "MISSING_SCOPE":
      return "I need you to reconnect Spotify once so Aurum can edit playlists.";
    case "PLAYLIST_NOT_WRITABLE":
      return "I found the playlist, but this Spotify account can't edit it.";
    case "AUTH_REVOKED":
    case "TOKEN_EXPIRED":
      return "Spotify needs to be reconnected.";
    case "TRACK_NOT_FOUND":
      return "I couldn't find that track.";
    case "TRANSIENT_FAILURE":
      return "Spotify didn't complete that change. Try again in a moment.";
    case "PREMIUM_REQUIRED":
      return "Spotify Premium is required for playback control.";
    case "NO_ACTIVE_DEVICE":
      return "No active Spotify playback device.";
    case "RATE_LIMITED":
      return "Spotify rate limit reached. Try again shortly.";
    case "NOT_FOUND":
      return "Spotify resource not found.";
    case "SPOTIFY_REJECTED":
      return "Spotify couldn't make that playlist change.";
    default:
      return "Spotify didn't complete that change. Try again in a moment.";
  }
}

export function classifySpotifyFailure(
  opts: ClassifySpotifyFailureOpts,
): ClassifiedSpotifyFailure {
  const parsed = parseSpotifyErrorBody(opts.bodyText ?? "");
  const message = parsed.message;
  const lower = message.toLowerCase();
  const http = opts.httpStatus;
  const spotifyStatus = parsed.status ?? http;

  let code: SpotifyFailureCode = "EXECUTION_FAILED";

  if (http === 401) {
    code =
      lower.includes("revok") ||
      lower.includes("invalid access token") ||
      lower.includes("invalid_grant")
        ? "AUTH_REVOKED"
        : "TOKEN_EXPIRED";
  } else if (http === 403) {
    if (lower.includes("premium")) {
      code = "PREMIUM_REQUIRED";
    } else if (
      lower.includes("insufficient client scope") ||
      lower.includes("insufficient scope") ||
      lower.includes("missing scope") ||
      /\bscope\b/.test(lower)
    ) {
      code = "MISSING_SCOPE";
    } else if (
      lower.includes("you cannot add") ||
      lower.includes("not (allowed|authorized) to") ||
      lower.includes("don't own") ||
      lower.includes("do not own") ||
      lower.includes("doesn't own") ||
      lower.includes("collaborator") ||
      (opts.playlistOwnerMatchesUser === false &&
        opts.collaborative === false)
    ) {
      code = "PLAYLIST_NOT_WRITABLE";
    } else if (opts.playlistOwnerMatchesUser === false) {
      code = "PLAYLIST_NOT_WRITABLE";
    } else {
      // Unknown 403 — do not assume missing scope vs unwritable.
      code = "SPOTIFY_REJECTED";
    }
  } else if (http === 404) {
    if (lower.includes("device") || lower.includes("player")) {
      code = "NO_ACTIVE_DEVICE";
    } else if (
      opts.action === "add_tracks" ||
      lower.includes("track") ||
      lower.includes("uri")
    ) {
      code = "TRACK_NOT_FOUND";
    } else {
      code = "NOT_FOUND";
    }
  } else if (http === 429) {
    code = "RATE_LIMITED";
  } else if (http >= 500 || http === 0) {
    code = "TRANSIENT_FAILURE";
  } else if (http === 400) {
    if (lower.includes("invalid_grant") || lower.includes("revok")) {
      code = "AUTH_REVOKED";
    } else if (lower.includes("track") || lower.includes("uri")) {
      code = "TRACK_NOT_FOUND";
    } else {
      code = "SPOTIFY_REJECTED";
    }
  } else {
    code = "EXECUTION_FAILED";
  }

  const reconnectRequired =
    code === "MISSING_SCOPE" ||
    code === "AUTH_REVOKED" ||
    code === "TOKEN_EXPIRED";

  return {
    code,
    reconnectRequired,
    httpStatus: http,
    spotifyErrorStatus: spotifyStatus,
    spotifyErrorMessage: message,
    userMessage: userMessageForSpotifyCode(code),
  };
}

export function logSpotifyAction(opts: {
  action: string;
  httpStatus?: number | null;
  spotifyErrorStatus?: number | null;
  spotifyErrorMessage?: string | null;
  requiredScope?: string | string[] | null;
  playlistIdPresent?: boolean;
  playlistOwnerMatchesUser?: boolean | null;
  collaborative?: boolean | null;
  tokenScopes?: string[] | null;
  code?: string;
}): void {
  const required = Array.isArray(opts.requiredScope)
    ? opts.requiredScope.join(" ")
    : (opts.requiredScope ?? "");
  console.info("[aurum:spotify]", {
    action: opts.action,
    http_status: opts.httpStatus ?? null,
    spotify_error_status: opts.spotifyErrorStatus ?? null,
    spotify_error_message: opts.spotifyErrorMessage
      ? sanitizeSpotifyErrorText(opts.spotifyErrorMessage)
      : null,
    required_scope: required || null,
    playlist_id_present: Boolean(opts.playlistIdPresent),
    playlist_owner_matches_user:
      opts.playlistOwnerMatchesUser == null
        ? null
        : Boolean(opts.playlistOwnerMatchesUser),
    collaborative:
      opts.collaborative == null ? null : Boolean(opts.collaborative),
    token_scopes: Array.isArray(opts.tokenScopes) ? opts.tokenScopes : [],
    code: opts.code ?? null,
  });
}

export function toToolErrorCode(code: SpotifyFailureCode): ToolErrorCode {
  return code as ToolErrorCode;
}
