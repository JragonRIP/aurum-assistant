import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySpokenAddress } from "./spoken-address";
import { buildSpeechResponse } from "./speech";

describe("spoken address — sir", () => {
  it("adds sir once to short confirmations", () => {
    assert.equal(applySpokenAddress("Spotify is open."), "Spotify is open, sir.");
    assert.equal(applySpokenAddress("It's 10:34 PM."), "It's 10:34 PM, sir.");
    assert.equal(applySpokenAddress("Done."), "Done, sir.");
    assert.equal(applySpokenAddress("Certainly."), "Certainly, sir.");
  });

  it("does not double sir", () => {
    assert.equal(
      applySpokenAddress("Spotify is open, sir."),
      "Spotify is open, sir.",
    );
    assert.doesNotMatch(
      applySpokenAddress("Certainly, sir."),
      /sir,\s*sir/i,
    );
  });

  it("keeps longer answers to at most one sir", () => {
    const spoken = applySpokenAddress(
      "Your Peak Life playlist is ready. I also checked the weather. Traffic looks light on the way home.",
    );
    const matches = spoken.match(/\bsir\b/gi) ?? [];
    assert.ok(matches.length <= 1);
    assert.match(spoken, /home, sir\./);
  });

  it("skips casual one-word replies that would sound theatrical", () => {
    assert.equal(applySpokenAddress("Okay."), "Okay.");
    assert.equal(applySpokenAddress("Sure thing!"), "Sure thing!");
  });

  it("does not apply when address is none", () => {
    assert.equal(
      applySpokenAddress("Spotify is open.", "none"),
      "Spotify is open.",
    );
  });

  it("display vs spoken: speech layer adds sir, source text stays clean", () => {
    const display =
      "I need you to reconnect Spotify once so Aurum can edit playlists.";
    const spoken = applySpokenAddress(display);
    assert.equal(
      display,
      "I need you to reconnect Spotify once so Aurum can edit playlists.",
    );
    assert.equal(
      spoken,
      "I need you to reconnect Spotify once so Aurum can edit playlists, sir.",
    );
  });

  it("10 consecutive short turns use sir at most once each", () => {
    const turns = [
      "It's 10:34 PM.",
      "Spotify is open.",
      "Your playlist is ready.",
      "I found three meetings on your schedule today.",
      "Volume is set to 30%.",
      "Calculator is closed.",
      "That's handled.",
      "Certainly.",
      "I need you to reconnect Spotify once so Aurum can edit playlists.",
      "Spotify didn't complete that change. Try again in a moment.",
    ];
    for (const turn of turns) {
      const spoken = applySpokenAddress(turn);
      const count = (spoken.match(/\bsir\b/gi) ?? []).length;
      assert.ok(count <= 1, `expected 0–1 sir in "${spoken}"`);
      assert.doesNotMatch(spoken, /sir,\s*sir/i);
    }
  });

  it("buildSpeechResponse applies sir after pronunciation", () => {
    const spoken = buildSpeechResponse("Spotify is open.");
    assert.match(spoken, /Spotify is open, sir\./);
  });

  it("skipAddress leaves display-style text unaddressed", () => {
    assert.equal(
      buildSpeechResponse("Spotify is open.", { skipAddress: true }),
      "Spotify is open.",
    );
  });
});
