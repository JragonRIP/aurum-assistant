/**
 * Pronunciation layer tests — spoken text only; display text unchanged by design.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSpeechResponse } from "./speech";
import {
  applySpokenPronunciation,
  BUILTIN_PRONUNCIATIONS,
} from "./spoken-pronunciation";

describe("spoken pronunciation", () => {
  it("distinguishes live verb vs adjective", () => {
    const verb = applySpokenPronunciation("I live in Michigan.", {
      preference: "americanized_british",
    });
    const adj = applySpokenPronunciation("This is a live system.", {
      preference: "americanized_british",
    });
    assert.match(verb, /\bliv\b/i);
    assert.doesNotMatch(verb, /\blyve\b/i);
    assert.match(adj, /\blyve\b/i);
    assert.doesNotMatch(adj, /\bliv\b/i);
  });

  it("americanizes privacy for default preference", () => {
    const am = applySpokenPronunciation("Aurum protects your privacy.", {
      preference: "americanized_british",
    });
    assert.match(am, /PRY-vuh-see/i);
    const br = applySpokenPronunciation("Aurum protects your privacy.", {
      preference: "british",
    });
    assert.match(br, /PRIV-uh-see/i);
  });

  it("speaks Aurum brand consistently", () => {
    const s = applySpokenPronunciation("Tell me about Aurum.", {
      preference: "americanized_british",
    });
    assert.match(s, /OR-um/);
  });

  it("buildSpeechResponse applies pronunciation without altering source semantics", () => {
    const display = "I live in Michigan. This is a live voice system about privacy.";
    const spoken = buildSpeechResponse(display, { maxChars: 800 });
    assert.match(spoken, /\bliv\b/i);
    assert.match(spoken, /\blyve\b/i);
    assert.match(spoken, /PRY-vuh-see/i);
    // Display string itself is untouched by the helper (caller keeps original).
    assert.match(display, /\blive\b/);
    assert.match(display, /privacy/);
  });

  it("exposes extensible builtin dictionary", () => {
    assert.ok(BUILTIN_PRONUNCIATIONS.some((e) => e.term.toLowerCase() === "live"));
    assert.ok(
      BUILTIN_PRONUNCIATIONS.some((e) => e.term.toLowerCase() === "privacy"),
    );
  });

  it("accepts custom dictionary entries", () => {
    const s = applySpokenPronunciation("Hello Aidan.", {
      custom: [{ term: "Aidan", spoken: "AY-den" }],
    });
    assert.match(s, /AY-den/);
  });
});
