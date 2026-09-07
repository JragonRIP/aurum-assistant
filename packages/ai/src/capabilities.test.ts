import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCapabilitySummary } from "./capabilities";
import { buildSystemPrompt } from "./personality";

describe("capability awareness", () => {
  it("with web_search registered does not claim inability", () => {
    const summary = buildCapabilitySummary({
      registeredToolIds: ["web_search", "web_read_page", "web_image_search"],
      windowsDeviceOnline: true,
      approvedFolderCount: 1,
    });
    assert.match(summary, /Web search: AVAILABLE/);
    assert.match(summary, /Image search: AVAILABLE/);
    assert.doesNotMatch(summary, /Web search: not registered/);
  });

  it("with image search missing states accurately", () => {
    const summary = buildCapabilitySummary({
      registeredToolIds: ["web_search"],
    });
    assert.match(summary, /Image search: not available/);
  });

  it("download tool without approved folder asks for approval", () => {
    const summary = buildCapabilitySummary({
      registeredToolIds: ["web_download_file", "list_approved_folders"],
      windowsDeviceOnline: true,
      approvedFolderCount: 0,
    });
    assert.match(summary, /approves a folder/i);
  });

  it("temporary failure guidance is injected into system prompt contracts", () => {
    assert.match(
      buildSystemPrompt({
        now: new Date("2026-09-06T12:00:00Z"),
        capabilitySummary: buildCapabilitySummary({
          registeredToolIds: ["web_search", "spotify_create_playlist"],
          spotifyConnected: true,
        }),
      }),
      /Web search: AVAILABLE/,
    );
    assert.match(
      buildSystemPrompt({ now: new Date("2026-09-06T12:00:00Z") }),
      /never “I can't access the web/,
    );
  });

  it("spotify playlist tools surface as registered", () => {
    const summary = buildCapabilitySummary({
      registeredToolIds: [
        "spotify_create_playlist",
        "spotify_add_tracks_to_playlist",
        "spotify_clear_queue",
      ],
      spotifyConnected: true,
    });
    assert.match(summary, /playlist create/);
    assert.match(summary, /NOT supported by Spotify's API/);
  });
});
