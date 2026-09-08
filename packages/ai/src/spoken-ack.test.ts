import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySpokenAck,
  isInstantSpokenAction,
  looksLikeMultiSpokenAction,
  spokenAcknowledgementText,
} from "./spoken-ack";

describe("spoken acknowledgements", () => {
  it("does not pre-speak instant Spotify transport", () => {
    assert.equal(isInstantSpokenAction("spotify_pause"), true);
    assert.equal(classifySpokenAck({ tool: "spotify_pause" }), null);
    assert.equal(classifySpokenAck({ tool: "spotify_resume" }), null);
    assert.equal(classifySpokenAck({ tool: "spotify_next" }), null);
    assert.equal(classifySpokenAck({ tool: "get_current_time" }), null);
  });

  it("does not pre-speak a solo playlist play", () => {
    assert.equal(classifySpokenAck({ tool: "spotify_play_playlist" }), null);
  });

  it("acknowledges slow launches without claiming success", () => {
    assert.equal(classifySpokenAck({ tool: "open_application" }), "open_app");
    assert.equal(spokenAcknowledgementText("open_app"), "Opening it.");
    assert.equal(
      spokenAcknowledgementText("open_app", { appName: "Netflix" }),
      "Opening Netflix.",
    );
    assert.doesNotMatch(
      spokenAcknowledgementText("open_app", { appName: "Netflix" }),
      /is open/i,
    );
  });

  it("acknowledges playlist writes", () => {
    assert.equal(
      classifySpokenAck({ tool: "spotify_add_tracks_to_playlist" }),
      "playlist_write",
    );
    assert.equal(
      spokenAcknowledgementText("playlist_write"),
      "Updating the playlist.",
    );
  });

  it("uses one multi acknowledgement for combined requests", () => {
    assert.equal(
      looksLikeMultiSpokenAction(
        "Open Spotify, play Peak Life, and find me a Porsche 911 video.",
      ),
      true,
    );
    assert.equal(
      classifySpokenAck({
        tool: "open_application",
        toolsThisTurn: ["open_application"],
        userMessage:
          "Open Spotify, play Peak Life, and find me a Porsche 911 video.",
      }),
      "multi",
    );
    assert.equal(
      classifySpokenAck({
        toolsThisTurn: ["open_application", "web_search"],
      }),
      "multi",
    );
    assert.equal(spokenAcknowledgementText("multi"), "Working on that.");
  });

  it("does not acknowledge calendar reads", () => {
    assert.equal(classifySpokenAck({ tool: "list_calendar_events" }), null);
  });

  it("acknowledges calendar writes", () => {
    assert.equal(
      classifySpokenAck({ tool: "create_calendar_event" }),
      "calendar_write",
    );
  });
});
