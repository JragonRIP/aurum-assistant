import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LOCAL_TTS_SETTINGS,
  KOKORO_RECOMMENDED_VOICE,
} from "./types";
import { shouldRetryCompletedTtsHttpStatus } from "../tts-http-retry";

describe("local TTS contracts", () => {
  it("defaults to local Kokoro with recommended British voice", () => {
    assert.equal(DEFAULT_LOCAL_TTS_SETTINGS.speechEngine, "local");
    assert.equal(DEFAULT_LOCAL_TTS_SETTINGS.kokoroVoice, "bm_george");
    assert.equal(KOKORO_RECOMMENDED_VOICE, "bm_george");
    assert.equal(DEFAULT_LOCAL_TTS_SETTINGS.allowGeminiFallback, true);
  });

  it("desktop does not retry completed HTTP provider trees", () => {
    assert.equal(shouldRetryCompletedTtsHttpStatus(429), false);
    assert.equal(shouldRetryCompletedTtsHttpStatus(502), false);
  });

  it("tts service prefers Kokoro when healthy", () => {
    const src = readFileSync(join(__dirname, "tts-service.ts"), "utf8");
    assert.match(src, /tryKokoro/);
    assert.match(src, /fallback_to_gemini/);
    assert.match(src, /buildSpeechResponse/);
  });

  it("kokoro provider validates WAV RIFF header", () => {
    const src = readFileSync(join(__dirname, "kokoro-provider.ts"), "utf8");
    assert.match(src, /RIFF/);
    assert.match(src, /invalid_wav/);
  });

  it("voice engine manager binds only known server.py", () => {
    const src = readFileSync(
      join(__dirname, "voice-engine-manager.ts"),
      "utf8",
    );
    assert.match(src, /server\.py/);
    assert.match(src, /AURUM_VOICE_ENGINE_SECRET/);
    assert.match(src, /127\.0\.0\.1/);
    assert.match(src, /AURUM_VOICE_ENGINE_MODEL_READY/);
    assert.match(src, /loading_model/);
    assert.match(src, /resourcesPath/);
    assert.match(src, /resolveVoiceEngineLaunch/);
    assert.match(src, /HF_HUB_OFFLINE/);
  });

  it("tts service logs cloud_tts_called=false on Kokoro success", () => {
    const src = readFileSync(join(__dirname, "tts-service.ts"), "utf8");
    assert.match(src, /cloud_tts_called: false/);
    assert.match(src, /"selected"/);
  });
});
