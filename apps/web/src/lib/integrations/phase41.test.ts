import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultRegistry,
  resolveToolActivityLabel,
} from "@aurum/tools";
import {
  clampVolume,
  applyRelativeVolume,
  relativeVolumeDelta,
} from "@/lib/integrations/media-context";
import {
  SPOTIFY_SCOPES,
  SPOTIFY_SCOPES_STRING,
  DEFAULT_SPOTIFY_REDIRECT_URI,
  getSpotifyClientConfig,
  isValidOAuthStateShape,
  generateCodeVerifier,
  generateCodeChallenge,
  generateOAuthState,
} from "@/lib/integrations/spotify/oauth";
import { assertTrustedReferenceId } from "@/lib/integrations/spotify/references";
import { SPOTIFY } from "@/lib/integrations/registry";

describe("Phase 4.1 OAuth redirect URI", () => {
  it("defaults to 127.0.0.1 (Spotify rejects localhost aliases)", () => {
    assert.equal(
      DEFAULT_SPOTIFY_REDIRECT_URI,
      "http://127.0.0.1:3000/api/integrations/spotify/callback",
    );
    assert.equal(DEFAULT_SPOTIFY_REDIRECT_URI.includes("localhost"), false);
    const prev = process.env.SPOTIFY_REDIRECT_URI;
    delete process.env.SPOTIFY_REDIRECT_URI;
    try {
      assert.equal(
        getSpotifyClientConfig().redirectUri,
        DEFAULT_SPOTIFY_REDIRECT_URI,
      );
    } finally {
      if (prev !== undefined) process.env.SPOTIFY_REDIRECT_URI = prev;
      else delete process.env.SPOTIFY_REDIRECT_URI;
    }
  });
});

describe("Phase 4.1 OAuth state shape", () => {
  it("accepts a valid oauth state row shape", () => {
    const verifier = generateCodeVerifier();
    assert.ok(verifier.length >= 43);
    assert.ok(generateCodeChallenge(verifier).length > 20);
    assert.ok(generateOAuthState().length >= 16);

    assert.equal(
      isValidOAuthStateShape({
        state: generateOAuthState(),
        code_verifier: verifier,
        provider: "spotify",
        user_id: "00000000-0000-4000-8000-000000000001",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      }),
      true,
    );
  });

  it("rejects incomplete oauth state", () => {
    assert.equal(
      isValidOAuthStateShape({
        state: "short",
        code_verifier: "abc",
        provider: "gmail",
        user_id: "x",
      }),
      false,
    );
  });
});

describe("Phase 4.1 scopes", () => {
  it("includes playback plus playlist/library scopes (Phase 4.2)", () => {
    assert.ok(SPOTIFY_SCOPES.includes("user-read-playback-state"));
    assert.ok(SPOTIFY_SCOPES.includes("playlist-modify-private"));
    assert.ok(SPOTIFY_SCOPES.includes("user-library-modify"));
    assert.ok(SPOTIFY_SCOPES_STRING.includes("playlist"));
    assert.ok(SPOTIFY.capabilities.includes("MEDIA_PLAY"));
  });
});

describe("Phase 4.1 volume", () => {
  it("clamps volume to 0–100", () => {
    assert.equal(clampVolume(-5), 0);
    assert.equal(clampVolume(150), 100);
    assert.equal(clampVolume(37.6), 38);
    assert.equal(clampVolume(Number.NaN), 0);
  });

  it("applies relative volume math with clamp", () => {
    assert.equal(relativeVolumeDelta("a_little_quieter"), -10);
    assert.equal(relativeVolumeDelta("turn_down"), -15);
    assert.equal(relativeVolumeDelta("much_quieter"), -25);
    assert.equal(applyRelativeVolume(20, "turn_down"), 5);
    assert.equal(applyRelativeVolume(10, "much_quieter"), 0);
    assert.equal(applyRelativeVolume(90, "much_louder"), 100);
  });
});

describe("Phase 4.1 trusted references", () => {
  it("rejects fabricated track ids and spotify uris", () => {
    assert.equal(assertTrustedReferenceId("spotify:track:abc123"), null);
    assert.equal(assertTrustedReferenceId("not-a-uuid"), null);
    assert.equal(assertTrustedReferenceId(123), null);
    assert.equal(
      assertTrustedReferenceId("11111111-1111-4111-8111-111111111111"),
      "11111111-1111-4111-8111-111111111111",
    );
  });
});

describe("Phase 4.1 activity labels + registry", () => {
  it("resolves Spotify activity labels", () => {
    assert.equal(
      resolveToolActivityLabel("spotify_search_track", "x", {
        query: "Tha Mobb",
      }),
      "Finding Tha Mobb",
    );
    assert.equal(
      resolveToolActivityLabel("spotify_pause", "x"),
      "Pausing Spotify",
    );
    assert.equal(
      resolveToolActivityLabel("open_application", "x", { app: "Spotify" }),
      "Opening Spotify",
    );
  });

  it("registers Spotify tools as CLOUD and has no shell tools", () => {
    const registry = createDefaultRegistry();
    const pause = registry.get("spotify_pause");
    assert.ok(pause);
    assert.equal(pause!.environment, "CLOUD");
    assert.equal(pause!.permission, "SAFE_WRITE");
    assert.ok(registry.get("spotify_search_track"));
    assert.ok(registry.get("spotify_play_track"));
    assert.equal(registry.get("run_command"), undefined);
    assert.equal(registry.get("execute_shell"), undefined);
    assert.equal(registry.get("execute_powershell"), undefined);
  });
});
