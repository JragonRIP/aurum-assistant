import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = join(__dirname);
const webRoot = join(here, "..", "..", "..", "web", "src");

describe("voice capture finalization contracts", () => {
  it("waits for stop then flushes before assembling Blob", () => {
    const src = readFileSync(join(here, "voice-capture.ts"), "utf8");
    assert.match(src, /addEventListener\(\s*["']stop["']/);
    assert.match(src, /setTimeout\(finish,\s*0\)/);
    assert.match(src, /dataavailable/);
    assert.match(src, /requestData/);
    assert.match(src, /const finalized = await this\.finalizeRecorder\(\)/);
    const stopIdx = src.indexOf("async stop()");
    const finalizeIdx = src.indexOf("const finalized = await this.finalizeRecorder()");
    const cleanupIdx = src.indexOf("this.cleanupTracksOnly()", finalizeIdx);
    assert.ok(stopIdx >= 0 && finalizeIdx > stopIdx);
    assert.ok(cleanupIdx > finalizeIdx, "cleanup must run after finalize");
  });

  it("records requested vs actual mime diagnostics", () => {
    const src = readFileSync(join(here, "voice-capture.ts"), "utf8");
    assert.match(src, /requestedMimeType/);
    assert.match(src, /pickMimeType/);
    assert.match(src, /audio\/webm;codecs=opus/);
    assert.match(src, /blobBytes/);
    assert.match(src, /chunkCount/);
  });

  it("rejects zero and implausibly tiny blobs before submit", () => {
    const src = readFileSync(join(here, "voice-capture.ts"), "utf8");
    assert.match(src, /VOICE_MIN_AUDIO_BYTES/);
    assert.match(src, /blob\.size <= 0/);
  });

  it("overlay submits after capture stop with diagnostics", () => {
    const src = readFileSync(join(here, "OverlayApp.tsx"), "utf8");
    assert.match(src, /captureRef\.current\.stop\(\)/);
    assert.match(src, /voiceTranscribe/);
    assert.match(src, /blobBytes/);
    assert.match(src, /chunkCount/);
  });
});

describe("voice bridge multipart contracts", () => {
  it("appends audio field with MIME and does not invent Content-Type", () => {
    const src = readFileSync(join(here, "..", "main", "voice-bridge.ts"), "utf8");
    assert.match(src, /form\.append\(\s*["']audio["']/);
    assert.match(src, /new Blob\(\[bytes\],\s*\{\s*type:/);
    assert.match(src, /transcriptLen/);
  });
});

describe("device transcribe route contracts", () => {
  it("uses distinct failure codes and audio field name", () => {
    const route = readFileSync(
      join(webRoot, "app", "api", "devices", "voice", "transcribe", "route.ts"),
      "utf8",
    );
    assert.match(route, /form\.get\(\s*["']audio["']\s*\)/);
    assert.match(route, /EMPTY_AUDIO/);
    assert.match(route, /NO_SPEECH_DETECTED/);
    assert.match(route, /STT_PROVIDER_ERROR/);
    assert.match(route, /UNSUPPORTED_AUDIO_FORMAT/);
    assert.match(route, /transcriptLen/);
  });
});
