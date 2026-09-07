/**
 * Unit tests for streaming sentence TTS helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSpeechResponse } from "@aurum/ai";
import {
  isSpeakableChunk,
  pullCompleteSentences,
} from "./speech-chunker";
import { StreamingTtsController } from "./streaming-tts";
import type { StreamingPlaybackSink } from "./streaming-tts";

describe("speech-chunker", () => {
  it("flushes first sentence on period before agent_complete", () => {
    const a = pullCompleteSentences("It's ten seventeen. More");
    assert.deepEqual(a.sentences, ["It's ten seventeen."]);
    assert.equal(a.remainder, "More");
  });

  it("preserves sentence order across deltas", () => {
    let buf = "";
    const out: string[] = [];
    for (const part of ["Hello ", "there. ", "How ", "are you? ", "Bye!"]) {
      buf += part;
      const { sentences, remainder } = pullCompleteSentences(buf);
      out.push(...sentences);
      buf = remainder;
    }
    const final = pullCompleteSentences(buf, { flush: true });
    out.push(...final.sentences);
    assert.deepEqual(out, ["Hello there.", "How are you?", "Bye!"]);
  });

  it("one-sentence short reply flushes immediately", () => {
    const r = pullCompleteSentences("It's 10:17 AM.");
    assert.deepEqual(r.sentences, ["It's 10:17 AM."]);
    assert.equal(r.remainder, "");
  });

  it("does not duplicate sentence boundaries", () => {
    const r = pullCompleteSentences("One. Two. Three.");
    assert.deepEqual(r.sentences, ["One.", "Two.", "Three."]);
  });

  it("keeps trailing fragment until flush", () => {
    const mid = pullCompleteSentences("Working on your schedule");
    assert.deepEqual(mid.sentences, []);
    assert.match(mid.remainder, /Working/);
    const end = pullCompleteSentences(mid.remainder, { flush: true });
    assert.deepEqual(end.sentences, ["Working on your schedule"]);
  });

  it("normalizes markdown per chunk without rewriting meaning", () => {
    const spoken = buildSpeechResponse("**Hello** world. See https://x.test/y");
    assert.match(spoken, /Hello world/i);
    assert.doesNotMatch(spoken, /https?:/);
    assert.doesNotMatch(spoken, /\*\*/);
  });

  it("isSpeakableChunk rejects empty", () => {
    assert.equal(isSpeakableChunk("   "), false);
    assert.equal(isSpeakableChunk("Hi."), true);
  });
});

describe("StreamingTtsController", () => {
  it("synthesizes first sentence before agent_complete", async () => {
    const order: string[] = [];
    const synthTexts: string[] = [];
    const playback = {
      beginTurn() {
        order.push("begin");
      },
      stop() {
        order.push("stop");
      },
      enqueueBase64(_b64: string, _mime: string, opts: { chunkIndex: number }) {
        order.push(`enqueue:${opts.chunkIndex}`);
      },
    } as unknown as StreamingPlaybackSink;


    let resolveSynth!: () => void;
    const synthGate = new Promise<void>((r) => {
      resolveSynth = r;
    });

    const ctl = new StreamingTtsController({
      playback,
      synthesize: async ({ text }) => {
        synthTexts.push(text);
        order.push("synth_start");
        await synthGate;
        order.push("synth_done");
        return {
          ok: true,
          audioBase64: Buffer.from("RIFF").toString("base64"),
          mimeType: "audio/wav",
          audioBytes: 4,
          latencyMs: 10,
          provider: "kokoro",
        };
      },
    });

    ctl.beginTurn();
    ctl.onDelta("It's ten. ");
    // First sentence should already be queued for synth.
    await Promise.resolve();
    assert.ok(order.includes("synth_start"));
    assert.ok(!order.includes("enqueue:0"));
    assert.equal(ctl.getMarks().agent_first_sentence_ready != null, true);
    assert.equal(ctl.getMarks().agent_complete == null, true);

    resolveSynth();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(order.includes("enqueue:0"));

    ctl.onAgentComplete();
    assert.ok(ctl.getMarks().agent_complete != null);
    assert.ok(
      (ctl.getMarks().agent_first_sentence_ready as number) <=
        (ctl.getMarks().agent_complete as number),
    );
    assert.match(synthTexts[0] ?? "", /ten/i);
  });

  it("preserves chunk order and serializes synth (max 1 active)", async () => {
    let active = 0;
    let maxActive = 0;
    const enqueued: number[] = [];
    const playback = {
      beginTurn() {},
      stop() {},
      enqueueBase64(
        _b: string,
        _m: string,
        opts: { chunkIndex: number },
      ) {
        enqueued.push(opts.chunkIndex);
      },
    } as unknown as StreamingPlaybackSink;


    const ctl = new StreamingTtsController({
      playback,
      synthesize: async ({ text }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
        return {
          ok: true,
          audioBase64: Buffer.from(text).toString("base64"),
          mimeType: "audio/wav",
          provider: "kokoro",
          audioBytes: text.length,
        };
      },
    });

    ctl.beginTurn();
    ctl.onDelta("One. Two. Three.");
    ctl.onAgentComplete();
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(maxActive, 1);
    assert.deepEqual(enqueued, [0, 1, 2]);
  });

  it("barge-in cancel drops pending synth results as stale", async () => {
    const enqueued: number[] = [];
    let finish!: () => void;
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const playback = {
      beginTurn() {},
      stop() {
        enqueued.push(-1);
      },
      enqueueBase64(
        _b: string,
        _m: string,
        opts: { chunkIndex: number },
      ) {
        enqueued.push(opts.chunkIndex);
      },
    } as unknown as StreamingPlaybackSink;


    const ctl = new StreamingTtsController({
      playback,
      synthesize: async () => {
        await gate;
        return {
          ok: true,
          audioBase64: "QQ==",
          mimeType: "audio/wav",
          provider: "kokoro",
        };
      },
    });

    ctl.beginTurn();
    ctl.onDelta("Long sentence one. ");
    await Promise.resolve();
    ctl.cancel();
    finish();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(enqueued.includes(-1));
    assert.equal(
      enqueued.filter((n) => n >= 0).length,
      0,
      "stale chunk must not enqueue",
    );
  });

  it("flushes trailing fragment after stream ends", async () => {
    const texts: string[] = [];
    const playback = {
      beginTurn() {},
      stop() {},
      enqueueBase64() {},
    } as unknown as StreamingPlaybackSink;

    const ctl = new StreamingTtsController({
      playback,
      synthesize: async ({ text }) => {
        texts.push(text);
        return {
          ok: true,
          audioBase64: "QQ==",
          mimeType: "audio/wav",
          provider: "kokoro",
        };
      },
    });
    ctl.beginTurn();
    ctl.onDelta("No punctuation yet");
    assert.equal(texts.length, 0);
    ctl.onAgentComplete();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(texts.length, 1);
    assert.match(texts[0]!, /No punctuation/);
  });
});

describe("VoicePlayback queue contracts", () => {
  it("exposes queue helpers and beginTurn", () => {
    const src = readFileSync(join(__dirname, "voice-playback.ts"), "utf8");
    assert.match(src, /enqueueBase64/);
    assert.match(src, /beginTurn/);
    assert.match(src, /queueLength/);
    assert.match(src, /this\.turnId = -1/);
  });

  it("OverlayApp streams sentences before agent_complete", () => {
    const src = readFileSync(join(__dirname, "OverlayApp.tsx"), "utf8");
    assert.match(src, /StreamingTtsController/);
    assert.match(src, /onDelta/);
    assert.match(src, /onAgentComplete/);
    assert.match(src, /cancelStreamingSpeech/);
    assert.match(src, /bypassSpokenMode/);
  });
});
