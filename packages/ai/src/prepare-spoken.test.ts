import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareSpokenText } from "./prepare-spoken";
import { simplifySpokenText, wantsFullSpokenReadback } from "./spoken-simplify";

describe("prepareSpokenText", () => {
  it("adds sir once to a short factual answer without rewriting the clock", () => {
    const display = "It's 10:34 PM.";
    const result = prepareSpokenText({ text: display, origin: "ptt" });
    assert.equal(display, "It's 10:34 PM.");
    assert.equal(result.spoken, "It's 10:34 PM, sir.");
    assert.equal(result.addressApplied, true);
    assert.ok(result.prepareMs < 10);
  });

  it("does not add sir when it was already used this turn", () => {
    const result = prepareSpokenText({
      text: "Netflix is open.",
      addressAlreadyUsed: true,
      origin: "stream",
    });
    assert.equal(result.spoken, "Netflix is open.");
    assert.equal(result.addressApplied, false);
  });

  it("deduplicates a model-provided sir", () => {
    const result = prepareSpokenText({
      text: "Spotify is open, sir.",
      origin: "ptt",
    });
    assert.equal((result.spoken.match(/\bsir\b/gi) ?? []).length, 1);
    assert.doesNotMatch(result.spoken, /sir,\s*sir/i);
  });

  it("uses structured tool summaries instead of reading the display", () => {
    const display = "Spotify is open and your Peak Life playlist is playing.";
    const result = prepareSpokenText({
      text: display,
      origin: "ptt",
      toolHints: [
        {
          tool: "spotify_play_playlist",
          success: true,
          data: { name: "Peak Life" },
        },
      ],
    });
    assert.equal(display.includes("Spotify is open"), true);
    assert.equal(result.spoken, "Peak Life is playing, sir.");
    assert.equal(result.simplified, true);
  });

  it("shortens long display prose for voice", () => {
    const display =
      "I found three events on your calendar today. You have class at 8:00 AM, a meeting at 3:30 PM, and a call at 6:00 PM.";
    const result = prepareSpokenText({ text: display, origin: "ptt" });
    assert.match(result.spoken, /three things today/i);
    assert.ok(result.spoken.length < display.length);
    assert.ok((result.spoken.match(/\bsir\b/gi) ?? []).length <= 1);
  });

  it("keeps longer spoken output when the user asks to hear everything", () => {
    const display =
      "First sentence stays. Second sentence stays. Third sentence stays. Fourth would normally be dropped.";
    const concise = prepareSpokenText({ text: display, origin: "ptt" });
    const full = prepareSpokenText({
      text: display,
      origin: "ptt",
      userMessage: "Read the whole thing",
    });
    assert.equal(wantsFullSpokenReadback("Read the whole thing"), true);
    assert.ok(full.spoken.length >= concise.spoken.length);
    assert.match(full.spoken, /Fourth would normally be dropped/i);
  });

  it("applies pronunciation after address", () => {
    const display = "This is a live privacy system.";
    const result = prepareSpokenText({ text: display, origin: "ptt" });
    assert.equal(display, "This is a live privacy system.");
    assert.match(result.spoken, /lyve/i);
    assert.match(result.spoken, /PRY-vuh-see/i);
    assert.match(result.spoken, /system, sir/i);
    assert.equal(display, "This is a live privacy system.");
  });

  it("speaks playlist permission failures without codes", () => {
    const result = prepareSpokenText({
      text: "spotify_add_tracks_to_playlist failed with MISSING_SCOPE 403",
      origin: "ptt",
      toolHints: [
        {
          tool: "spotify_add_tracks_to_playlist",
          success: false,
          errorCode: "MISSING_SCOPE",
        },
      ],
    });
    assert.match(result.spoken, /reconnect Spotify/i);
    assert.doesNotMatch(result.spoken, /MISSING_SCOPE|403|spotify_add/i);
  });

  it("does not claim success in acknowledgement text", () => {
    const result = prepareSpokenText({
      text: "Opening Netflix.",
      origin: "ack",
      skipSimplification: true,
    });
    assert.equal(result.spoken, "Opening Netflix, sir.");
    assert.doesNotMatch(result.spoken, /is open/i);
  });
});

describe("simplifySpokenText", () => {
  it("compresses known display patterns", () => {
    assert.equal(
      simplifySpokenText(
        "The search service is temporarily unavailable, but Spotify opened successfully.",
      ).text,
      "Spotify's open. Search is unavailable right now.",
    );
    assert.equal(
      simplifySpokenText(
        "The file was saved successfully to your Documents folder.",
      ).text,
      "Saved to Documents.",
    );
  });

  it("joins multi-tool results into one spoken summary", () => {
    const out = simplifySpokenText("Long display about several tools.", {
      toolHints: [
        {
          tool: "spotify_play_playlist",
          success: true,
          data: { name: "Peak Life" },
        },
        {
          tool: "web_search",
          success: false,
          errorCode: "PROVIDER_UNAVAILABLE",
        },
      ],
    });
    assert.equal(out.text, "Peak Life is playing. Search is unavailable right now.");
  });
});
