import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldSpeakResponse } from "@aurum/shared";
import {
  decideVoiceTts,
  SHORT_ONLY_MAX_CHARS,
  SHORT_ONLY_MAX_SENTENCES,
} from "./voice-tts";
import { pcmOrBlob } from "./wav-audio";

const here = join(__dirname);

describe("short_only TTS eligibility", () => {
  it("voice-origin short reply qualifies under short_only", () => {
    const speech = "It's 10:15 PM.";
    assert.equal(
      shouldSpeakResponse({
        inputMode: "voice",
        spokenMode: "short_only",
        speechText: speech,
      }),
      true,
    );
    assert.equal(
      decideVoiceTts({
        origin: "voice",
        spokenMode: "short_only",
        speechText: speech,
      }).eligible,
      true,
    );
  });

  it("text-origin reply does not auto-speak", () => {
    assert.equal(
      decideVoiceTts({
        origin: "text",
        spokenMode: "always_voice",
        speechText: "It's 10:15 PM.",
      }).eligible,
      false,
    );
  });

  it("short_only rejects long multi-sentence replies", () => {
    const long = `${"Hello world. ".repeat(40)}`;
    const decision = decideVoiceTts({
      origin: "voice",
      spokenMode: "short_only",
      speechText: long,
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.reason, "short_only_too_long");
    assert.equal(SHORT_ONLY_MAX_CHARS, 280);
    assert.equal(SHORT_ONLY_MAX_SENTENCES, 3);
  });

  it("spoken mode never suppresses TTS", () => {
    assert.equal(
      decideVoiceTts({
        origin: "voice",
        spokenMode: "never",
        speechText: "Done.",
      }).eligible,
      false,
    );
  });
});

describe("playback blob construction", () => {
  it("wraps L16 PCM as audio/wav blob", () => {
    const pcm = new Uint8Array(48);
    const blob = pcmOrBlob(pcm, "audio/L16;codec=pcm;rate=24000");
    assert.equal(blob.type, "audio/wav");
    assert.ok(blob.size > pcm.byteLength);
  });
});

describe("OverlayApp TTS contracts", () => {
  it("syncs replyRef before voice TTS and does not gate on stale error", () => {
    const src = readFileSync(join(here, "OverlayApp.tsx"), "utf8");
    assert.match(src, /writeReply/);
    assert.match(src, /replyRef\.current = next/);
    assert.match(src, /Do not gate on closed-over React `error`/);
    assert.match(src, /spokeForTurn/);
    assert.match(src, /play_promise_resolved/);
    assert.match(src, /origin:\s*opts\.origin/);
    assert.match(src, /log\(["']synth_request_started["']/);
  });

  it("awaits audio.play rejection handling via VoicePlayback", () => {
    const src = readFileSync(join(here, "voice-playback.ts"), "utf8");
    assert.match(src, /await audio\.play\(\)/);
    assert.match(src, /NotAllowedError/);
    assert.match(src, /onError/);
    assert.match(src, /this\.audio = audio/);
    assert.match(src, /getVoicePlayback/);
  });

  it("overlay enables autoplay without user gesture", () => {
    const main = readFileSync(join(here, "..", "main", "index.ts"), "utf8");
    assert.match(main, /autoplay-policy/);
    assert.match(main, /autoplayPolicy:\s*["']no-user-gesture-required["']/);
  });
});
