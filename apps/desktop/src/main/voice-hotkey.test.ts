import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VOICE_PTT_HOLD_MS,
  initialVoicePttState,
  reduceVoicePtt,
  shouldSpeakResponse,
} from "@aurum/shared";

describe("voice PTT hotkey machine", () => {
  it("tap below threshold only toggles text overlay", () => {
    let state = initialVoicePttState();
    let r = reduceVoicePtt(state, { type: "press", at: 1000 });
    state = r.state;
    assert.equal(state.phase, "press_pending");
    assert.ok(r.effects.some((e) => e.type === "ensure_overlay_visible"));

    r = reduceVoicePtt(state, {
      type: "tick",
      at: 1000 + VOICE_PTT_HOLD_MS - 50,
      spaceDown: false,
      ctrlDown: true,
    });
    assert.equal(r.state.phase, "idle");
    assert.ok(r.effects.some((e) => e.type === "tap_toggle"));
    assert.ok(!r.effects.some((e) => e.type === "start_listening"));
  });

  it("hold past threshold starts listening then submits on release", () => {
    let state = initialVoicePttState();
    state = reduceVoicePtt(state, { type: "press", at: 0 }).state;
    let r = reduceVoicePtt(state, {
      type: "tick",
      at: VOICE_PTT_HOLD_MS + 10,
      spaceDown: true,
      ctrlDown: true,
    });
    assert.equal(r.state.phase, "listening");
    assert.ok(r.effects.some((e) => e.type === "start_listening"));
    state = r.state;
    r = reduceVoicePtt(state, {
      type: "tick",
      at: VOICE_PTT_HOLD_MS + 200,
      spaceDown: false,
      ctrlDown: true,
    });
    assert.equal(r.state.phase, "idle");
    assert.ok(r.effects.some((e) => e.type === "stop_and_submit"));
  });

  it("cancel during listening discards capture", () => {
    let state = initialVoicePttState();
    state = reduceVoicePtt(state, { type: "press", at: 0 }).state;
    state = reduceVoicePtt(state, {
      type: "tick",
      at: VOICE_PTT_HOLD_MS + 1,
      spaceDown: true,
      ctrlDown: true,
    }).state;
    const r = reduceVoicePtt(state, { type: "cancel", at: 9999 });
    assert.equal(r.state.phase, "idle");
    assert.ok(r.effects.some((e) => e.type === "cancel_capture"));
  });

  it("ignores duplicate press while session active", () => {
    let state = initialVoicePttState();
    state = reduceVoicePtt(state, { type: "press", at: 0 }).state;
    const r = reduceVoicePtt(state, { type: "press", at: 50 });
    assert.ok(r.effects.some((e) => e.type === "debounce_ignore"));
  });
});

describe("spoken mode gating", () => {
  it("speaks voice-origin always_voice", () => {
    assert.equal(
      shouldSpeakResponse({
        inputMode: "voice",
        spokenMode: "always_voice",
        speechText: "Done.",
      }),
      true,
    );
  });
  it("never speaks for text input", () => {
    assert.equal(
      shouldSpeakResponse({
        inputMode: "text",
        spokenMode: "always_voice",
        speechText: "Done.",
      }),
      false,
    );
  });
});
