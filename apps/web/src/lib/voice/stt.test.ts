import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractTranscript, normalizeAudioMime } from "./stt";

describe("extractTranscript", () => {
  it("reads Part.audioTranscription.text from dedicated STT responses", () => {
    const out = extractTranscript({
      candidates: [
        {
          content: {
            parts: [
              {
                audioTranscription: {
                  text: "Hello Aurum, what time is it?",
                  finished: true,
                },
              },
            ],
          },
        },
      ],
    });
    assert.equal(out.transcript, "Hello Aurum, what time is it?");
    assert.equal(out.source, "audioTranscription");
  });

  it("falls back to response.text and part.text", () => {
    assert.equal(
      extractTranscript({ text: "from text getter field" }).transcript,
      "from text getter field",
    );
    assert.equal(
      extractTranscript({
        candidates: [{ content: { parts: [{ text: "part text" }] } }],
      }).transcript,
      "part text",
    );
  });

  it("prefers audioTranscription over empty text parts", () => {
    const out = extractTranscript({
      text: "",
      candidates: [
        {
          content: {
            parts: [
              { text: "", audioTranscription: { text: "spoken words" } },
            ],
          },
        },
      ],
    });
    assert.equal(out.transcript, "spoken words");
    assert.equal(out.source, "audioTranscription");
  });

  it("returns empty when nothing present (NO_SPEECH path)", () => {
    const out = extractTranscript({ candidates: [{ content: { parts: [] } }] });
    assert.equal(out.transcript, "");
    assert.equal(out.source, "empty");
  });

  it("old text-only extractor would miss audioTranscription (regression guard)", () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [{ audioTranscription: { text: "missed by old path" } }],
          },
        },
      ],
    };
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const old = parts
      .map((p) => ("text" in p && typeof p.text === "string" ? p.text : "") || "")
      .join("")
      .trim();
    assert.equal(old, "");
    assert.equal(extractTranscript(response).transcript, "missed by old path");
  });
});

describe("normalizeAudioMime", () => {
  it("strips codec parameters and preserves audio/*", () => {
    assert.equal(normalizeAudioMime("audio/webm;codecs=opus"), "audio/webm");
    assert.equal(normalizeAudioMime("audio/ogg;codecs=opus"), "audio/ogg");
    assert.equal(normalizeAudioMime("audio/mp4"), "audio/mp4");
  });
});
