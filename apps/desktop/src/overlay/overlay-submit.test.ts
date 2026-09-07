import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  overlaySubmitBlockReason,
  shouldAutoSubmitVoiceTranscript,
} from "./overlay-submit";
import { shouldSpeakResponse } from "@aurum/shared";

const here = join(__dirname);

describe("overlaySubmitBlockReason", () => {
  const idle = {
    text: "What time is it?",
    paired: true,
    streaming: false,
    awaitingApproval: false,
    listening: false,
    transcribing: false,
  };

  it("allows ready paired text", () => {
    assert.equal(overlaySubmitBlockReason(idle), null);
  });

  it("blocks empty transcript", () => {
    assert.equal(overlaySubmitBlockReason({ ...idle, text: "  " }), "empty");
  });

  it("blocks unpaired device", () => {
    assert.equal(overlaySubmitBlockReason({ ...idle, paired: false }), "unpaired");
  });

  it("blocks while streaming / listening / transcribing / approval", () => {
    assert.equal(overlaySubmitBlockReason({ ...idle, streaming: true }), "busy");
    assert.equal(overlaySubmitBlockReason({ ...idle, listening: true }), "busy");
    assert.equal(
      overlaySubmitBlockReason({ ...idle, transcribing: true }),
      "busy",
    );
    assert.equal(
      overlaySubmitBlockReason({ ...idle, awaitingApproval: true }),
      "busy",
    );
  });
});

describe("voice auto-submit contracts", () => {
  it("successful nonempty PTT transcript should auto-submit", () => {
    assert.equal(shouldAutoSubmitVoiceTranscript("What time is it?"), true);
    assert.equal(shouldAutoSubmitVoiceTranscript("   "), false);
    assert.equal(shouldAutoSubmitVoiceTranscript(""), false);
  });

  it("OverlayApp uses canonical submitOverlayRequest for text and voice", () => {
    const src = readFileSync(join(here, "OverlayApp.tsx"), "utf8");
    assert.match(src, /submitOverlayRequest/);
    assert.match(src, /origin:\s*["']voice["']/);
    assert.match(src, /origin:\s*["']text["']/);
    assert.match(src, /submitOverlayRequestRef/);
    // Voice path must call canonical submit, not only setCommand
    assert.match(
      src,
      /submitOverlayRequestRef\.current\(\s*\{\s*text:[\s\S]*?origin:\s*["']voice["']/,
    );
    // Typed path still goes through the same function
    assert.match(src, /handleSubmit[\s\S]*submitOverlayRequest\(\s*\{/);
    // PTT handler must not rely on a stale closed-over paired/streaming flag
    assert.match(src, /pairedRef\.current/);
    assert.match(src, /streamingRef\.current/);
    assert.match(src, /transcribingRef\.current\s*=\s*false/);
  });

  it("voice origin survives to final TTS trigger", () => {
    const src = readFileSync(join(here, "OverlayApp.tsx"), "utf8");
    assert.match(src, /voiceOriginRef\.current\s*=\s*opts\.origin\s*===\s*["']voice["']/);
    assert.match(src, /voiceOriginRef\.current && replyRef\.current\.trim\(\)/);
    assert.match(src, /speakFinalReply/);
  });

  it("typed Enter still required — no auto-submit on command change alone", () => {
    const src = readFileSync(join(here, "OverlayApp.tsx"), "utf8");
    assert.match(src, /onKeyDown/);
    assert.match(src, /handleSubmit/);
    assert.doesNotMatch(src, /onChange=\{[^}]*submitOverlayRequest/);
  });
});

describe("spoken mode TTS gating", () => {
  it("always_voice speaks nonempty voice-origin replies", () => {
    assert.equal(
      shouldSpeakResponse({
        inputMode: "voice",
        spokenMode: "always_voice",
        speechText: "It is 3 PM.",
      }),
      true,
    );
  });

  it("never suppresses TTS", () => {
    assert.equal(
      shouldSpeakResponse({
        inputMode: "voice",
        spokenMode: "never",
        speechText: "It is 3 PM.",
      }),
      false,
    );
  });

  it("short_only respects length heuristic", () => {
    assert.equal(
      shouldSpeakResponse({
        inputMode: "voice",
        spokenMode: "short_only",
        speechText: "Done.",
      }),
      true,
    );
    assert.equal(
      shouldSpeakResponse({
        inputMode: "voice",
        spokenMode: "short_only",
        speechText: "x".repeat(400),
      }),
      false,
    );
  });

  it("text origin never speaks even when always_voice", () => {
    assert.equal(
      shouldSpeakResponse({
        inputMode: "text",
        spokenMode: "always_voice",
        speechText: "Hello",
      }),
      false,
    );
  });
});
