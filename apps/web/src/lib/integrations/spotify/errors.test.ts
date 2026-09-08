import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySpotifyFailure,
  parseSpotifyErrorBody,
  userMessageForSpotifyCode,
} from "./errors";
import { assessPlaylistWritability } from "./playlist-access";
import {
  hasPlaylistWriteScopes,
  missingPlaylistWriteScopes,
  needsPlaylistEditReconnect,
  SPOTIFY_PLAYLIST_WRITE_SCOPES,
  SPOTIFY_SCOPES,
} from "./oauth";

describe("Spotify error classification", () => {
  it("does not treat every 403 as the same failure", () => {
    const scope = classifySpotifyFailure({
      httpStatus: 403,
      bodyText: JSON.stringify({
        error: { status: 403, message: "Insufficient client scope" },
      }),
      action: "add_tracks",
    });
    assert.equal(scope.code, "MISSING_SCOPE");
    assert.equal(scope.reconnectRequired, true);
    assert.match(scope.userMessage, /reconnect Spotify once/i);

    const unwritable = classifySpotifyFailure({
      httpStatus: 403,
      bodyText: JSON.stringify({
        error: {
          status: 403,
          message: "You cannot add tracks to a playlist you don't own.",
        },
      }),
      action: "add_tracks",
      playlistOwnerMatchesUser: false,
      collaborative: false,
    });
    assert.equal(unwritable.code, "PLAYLIST_NOT_WRITABLE");
    assert.equal(unwritable.reconnectRequired, false);

    const unknown = classifySpotifyFailure({
      httpStatus: 403,
      bodyText: JSON.stringify({
        error: { status: 403, message: "Forbidden" },
      }),
      action: "add_tracks",
    });
    assert.equal(unknown.code, "SPOTIFY_REJECTED");
    assert.equal(unknown.reconnectRequired, false);
  });

  it("maps 401 revoked vs expired distinctly but both reconnect", () => {
    const revoked = classifySpotifyFailure({
      httpStatus: 401,
      bodyText: JSON.stringify({
        error: { status: 401, message: "Invalid access token" },
      }),
    });
    assert.equal(revoked.code, "AUTH_REVOKED");
    assert.equal(revoked.reconnectRequired, true);

    const expired = classifySpotifyFailure({
      httpStatus: 401,
      bodyText: JSON.stringify({
        error: { status: 401, message: "The access token expired" },
      }),
    });
    assert.equal(expired.code, "TOKEN_EXPIRED");
    assert.equal(expired.reconnectRequired, true);
  });

  it("maps 5xx to transient and 404 tracks to TRACK_NOT_FOUND", () => {
    const transient = classifySpotifyFailure({
      httpStatus: 503,
      bodyText: "upstream",
    });
    assert.equal(transient.code, "TRANSIENT_FAILURE");
    assert.equal(transient.reconnectRequired, false);

    const missingTrack = classifySpotifyFailure({
      httpStatus: 404,
      bodyText: JSON.stringify({
        error: { status: 404, message: "Invalid track uri" },
      }),
      action: "add_tracks",
    });
    assert.equal(missingTrack.code, "TRACK_NOT_FOUND");
  });

  it("parses Spotify JSON without leaking token-like text", () => {
    const parsed = parseSpotifyErrorBody(
      JSON.stringify({
        error: {
          status: 403,
          message: "Insufficient client scope Bearer abc.def.ghi",
        },
      }),
    );
    assert.equal(parsed.status, 403);
    assert.doesNotMatch(parsed.message, /abc\.def/);
  });

  it("uses the required user-facing copy", () => {
    assert.equal(
      userMessageForSpotifyCode("MISSING_SCOPE"),
      "I need you to reconnect Spotify once so Aurum can edit playlists.",
    );
    assert.equal(
      userMessageForSpotifyCode("PLAYLIST_NOT_WRITABLE"),
      "I found the playlist, but this Spotify account can't edit it.",
    );
    assert.doesNotMatch(
      userMessageForSpotifyCode("SPOTIFY_REJECTED"),
      /Spotify rejected this action/,
    );
  });
});

describe("playlist writability", () => {
  it("treats owner match as writable", () => {
    const a = assessPlaylistWritability({
      ownerId: "user-1",
      currentUserId: "user-1",
      collaborative: false,
    });
    assert.equal(a.writable, true);
    assert.equal(a.ownerMatchesUser, true);
    assert.equal(a.reason, "owned");
  });

  it("fails closed for followed playlists the user does not own", () => {
    const a = assessPlaylistWritability({
      ownerId: "someone-else",
      currentUserId: "user-1",
      collaborative: false,
    });
    assert.equal(a.writable, false);
    assert.equal(a.reason, "not_writable");
  });

  it("allows collaborative playlists", () => {
    const a = assessPlaylistWritability({
      ownerId: "someone-else",
      currentUserId: "user-1",
      collaborative: true,
    });
    assert.equal(a.writable, true);
    assert.equal(a.reason, "collaborative");
  });
});

describe("canonical playlist-write scopes", () => {
  it("detects stale tokens missing playlist-modify scopes", () => {
    const old = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
    ];
    assert.deepEqual(
      missingPlaylistWriteScopes(old),
      [...SPOTIFY_PLAYLIST_WRITE_SCOPES],
    );
    assert.equal(hasPlaylistWriteScopes(old), false);
    assert.equal(needsPlaylistEditReconnect(old), true);
    assert.equal(hasPlaylistWriteScopes([...SPOTIFY_SCOPES]), true);
    assert.equal(needsPlaylistEditReconnect([...SPOTIFY_SCOPES]), false);
  });
});
