import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  inspectWav,
  pcmOrBlob,
  pcmToWav,
  parseSampleRateFromMime,
} from "./wav-audio";
import { getVoicePlayback } from "./voice-playback";

const here = join(__dirname);

describe("WAV / PCM construction", () => {
  it("builds a valid RIFF/WAVE header with expected PCM format", () => {
    const pcm = new Uint8Array(480);
    for (let i = 0; i < pcm.length; i += 2) {
      pcm[i] = 10;
      pcm[i + 1] = 0;
    }
    const wav = new Uint8Array(pcmToWav(pcm, 24000));
    const info = inspectWav(wav);
    assert.equal(info.ok, true);
    assert.equal(info.riff, "RIFF");
    assert.equal(info.wave, "WAVE");
    assert.equal(info.audioFormat, 1);
    assert.equal(info.numChannels, 1);
    assert.equal(info.sampleRate, 24000);
    assert.equal(info.bitsPerSample, 16);
    assert.equal(info.dataSize, 480);
    assert.ok((info.nonzeroSamples ?? 0) > 0);
  });

  it("parses rate from Gemini L16 mime and wraps as audio/wav", () => {
    assert.equal(
      parseSampleRateFromMime("audio/L16;codec=pcm;rate=24000"),
      24000,
    );
    const blob = pcmOrBlob(new Uint8Array(64), "audio/L16;rate=24000");
    assert.equal(blob.type, "audio/wav");
    assert.ok(blob.size >= 44 + 64 - (64 % 2));
  });

  it("rejects silent/empty PCM as invalid", () => {
    const silent = new Uint8Array(pcmToWav(new Uint8Array(64), 24000));
    const info = inspectWav(silent);
    assert.equal(info.ok, false);
    assert.equal(info.error, "invalid_or_silent_pcm");
  });
});

describe("VoicePlayback controller contracts", () => {
  it("retains Audio reference and only revokes URL on stop", () => {
    const src = readFileSync(join(here, "voice-playback.ts"), "utf8");
    assert.match(src, /this\.audio = audio/);
    assert.match(src, /audio\.volume = 1/);
    assert.match(src, /audio\.muted = false/);
    assert.match(src, /await audio\.play\(\)/);
    assert.match(src, /playErrorName/);
    assert.match(src, /URL\.revokeObjectURL/);
    assert.match(src, /getActiveAudio/);
    assert.match(src, /appendChild\(audio\)/);
    assert.match(src, /getVoicePlayback/);
    assert.match(src, /play_called/);
  });

  it("exposes PlaybackDiag for diagnostics", () => {
    const p = getVoicePlayback();
    assert.equal(p.isPlaying(), false);
    assert.equal(p.getActiveAudio(), null);
  });
});

describe("Overlay TTS diagnostic contracts", () => {
  it("logs VOICE_TTS chain and dumps debug wav via synthesize options", () => {
    const src = readFileSync(join(here, "OverlayApp.tsx"), "utf8");
    assert.match(src, /voiceLog/);
    assert.match(src, /debugDumpWav:\s*true/);
    assert.match(src, /speaking_entered/);
    assert.match(src, /play_promise_resolved/);
  });

  it("main voice-test bypasses spoken_mode and writes voice.log", () => {
    const main = readFileSync(join(here, "..", "main", "index.ts"), "utf8");
    assert.match(main, /aurum:voice-test/);
    assert.match(main, /bypassSpokenMode:\s*true/);
    assert.match(main, /appendVoiceLog/);
    assert.match(main, /aurum:voice-test-play/);
    assert.match(main, /getMasterAudioState/);
    assert.match(main, /setAudioMuted\(false\)/);
    assert.match(main, /isAudioMuted/);
    assert.match(main, /backgroundThrottling:\s*false/);
    assert.match(main, /aurum:voice-play-debug-wav/);
    const bridge = readFileSync(join(here, "..", "main", "voice-bridge.ts"), "utf8");
    assert.match(bridge, /aurum-tts-debug\.wav|debugWavPath/);
    assert.match(bridge, /inspectWav/);
    assert.match(bridge, /synth_attempt|withTtsHttpRetries/);
    assert.match(bridge, /playableMime = "audio\/wav"/);
  });

  it("Test Voice plays through overlay VoicePlayback", () => {
    const overlay = readFileSync(join(here, "OverlayApp.tsx"), "utf8");
    assert.match(overlay, /onVoiceTestPlay/);
    assert.match(overlay, /playbackRef\.current\.playBase64/);
    assert.match(overlay, /voiceTestPlayResult/);
    const preload = readFileSync(join(here, "..", "preload", "index.ts"), "utf8");
    assert.match(preload, /onVoiceTestPlay/);
    assert.match(preload, /voiceTestPlayResult/);
  });
});
