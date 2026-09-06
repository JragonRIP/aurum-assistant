import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyRelativeVolume,
  clampVolumePercent,
  createDefaultRegistry,
  evaluatePermission,
  resolveToolActivityLabel,
} from "@aurum/tools";
import {
  missingSpotifyScopes,
  needsSpotifyScopeUpgrade,
  SPOTIFY_SCOPES,
} from "@/lib/integrations/spotify/oauth";
import { assertTrustedReferenceId } from "@/lib/integrations/spotify/references";

describe("Phase 4.2 volume clamping", () => {
  it("clamps 0–100", () => {
    assert.equal(clampVolumePercent(-5), 0);
    assert.equal(clampVolumePercent(130), 100);
    assert.equal(clampVolumePercent(30.6), 31);
  });

  it("applies relative volume with clamp", () => {
    assert.equal(applyRelativeVolume(10, -20), 0);
    assert.equal(applyRelativeVolume(95, 10), 100);
  });
});

describe("Phase 4.2 Spotify scope upgrade", () => {
  it("detects missing playlist/library scopes", () => {
    const old = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
    ];
    const missing = missingSpotifyScopes(old);
    assert.ok(missing.includes("playlist-modify-private"));
    assert.ok(missing.includes("user-library-modify"));
    assert.equal(needsSpotifyScopeUpgrade(old), true);
    assert.equal(needsSpotifyScopeUpgrade([...SPOTIFY_SCOPES]), false);
  });
});

describe("Phase 4.2 trusted Spotify IDs", () => {
  it("rejects fabricated track ids and spotify uris", () => {
    assert.equal(assertTrustedReferenceId("spotify:track:abc"), null);
    assert.equal(assertTrustedReferenceId("not-a-uuid"), null);
    assert.ok(
      assertTrustedReferenceId("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
    );
  });
});

describe("Phase 4.2 registry + permissions", () => {
  it("registers Windows system and expanded Spotify tools", () => {
    const registry = createDefaultRegistry();
    assert.ok(registry.get("set_system_volume"));
    assert.ok(registry.get("lock_pc"));
    assert.ok(registry.get("shutdown_pc"));
    assert.ok(registry.get("spotify_create_playlist"));
    assert.ok(registry.get("spotify_add_playlist_items"));
    assert.ok(registry.get("spotify_transfer_playback"));
    assert.ok(registry.get("spotify_resolve_playlist"));
    assert.ok(registry.get("spotify_resolve_disambiguation"));
    assert.equal(registry.get("run_command"), undefined);
    assert.equal(registry.get("execute_shell"), undefined);
  });

  it("classifies destructive tools as CONFIRM", () => {
    const registry = createDefaultRegistry();
    assert.equal(registry.get("shutdown_pc")?.permission, "CONFIRM");
    assert.equal(registry.get("delete_file")?.permission, "CONFIRM");
    assert.equal(registry.get("close_window")?.permission, "SAFE_WRITE");
    assert.equal(registry.get("close_application")?.permission, "SAFE_WRITE");
    assert.equal(registry.get("terminate_process")?.permission, "CONFIRM");
    assert.equal(registry.get("lock_pc")?.permission, "SAFE_WRITE");
    const confirm = evaluatePermission("CONFIRM");
    assert.equal(confirm.allowed, true);
    assert.ok(confirm.allowed && confirm.mode === "confirm");
  });

  it("activity labels for volume and playlists", () => {
    assert.equal(
      resolveToolActivityLabel("set_system_volume", "Setting volume", {
        percent: 30,
      }),
      "Setting volume · 30%",
    );
    assert.equal(
      resolveToolActivityLabel("spotify_create_playlist", "Creating", {
        name: "Night Drive",
      }),
      "Creating playlist · Night Drive",
    );
  });
});
