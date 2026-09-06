import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AURUM_SYSTEM_INSTRUCTIONS,
  DEFAULT_RESPONSE_DETAIL_PREFERENCE,
  buildSystemPrompt,
} from "./personality";

describe("response style contracts", () => {
  it("defaults to concise preference", () => {
    assert.equal(DEFAULT_RESPONSE_DETAIL_PREFERENCE, "concise");
    const prompt = buildSystemPrompt({ now: new Date("2026-09-06T12:00:00Z") });
    assert.match(prompt, /Response detail preference for this session: concise/);
  });

  it("allows detailed preference override for future memory", () => {
    const prompt = buildSystemPrompt({
      responseDetailPreference: "detailed",
      now: new Date("2026-09-06T12:00:00Z"),
    });
    assert.match(prompt, /Response detail preference for this session: detailed/);
    assert.doesNotMatch(
      prompt,
      /Response detail preference for this session: concise \(default\)/,
    );
  });

  it("requires answer-first / stop-when-sufficient philosophy", () => {
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /Answer the user's actual question first and stop when the question has been sufficiently answered/,
    );
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /First sentence should usually contain the answer/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /minimum sufficient answer/);
  });

  it("scopes narrow price questions and allows explicit full breakdowns", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /how much\?.*price/i);
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /Do NOT expand a narrow question into a full product\/vehicle profile/,
    );
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /full breakdown/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Explicit user detail level always wins/);
  });

  it("keeps action and error confirmations short", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Calculator closed\./);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Volume set to 30%/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Do not narrate tool execution/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Spotify didn't change tracks/);
  });

  it("separates research depth from response length", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Research depth ≠ response length/);
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /final reply still answers only what was asked/,
    );
  });

  it("discourages mechanical optional follow-ups, heading dumps, and bullet spam", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /never append this mechanically/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Do not overuse bullets/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Do not overuse headings/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Overlay-first/);
  });

  it("keeps short follow-ups scoped to the new ask", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Short follow-ups inherit context/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /How much\?.*price only/i);
  });
});

/**
 * Behavioral expectations encoded as instruction contracts for the examples
 * in the conciseness brief (model output itself is not unit-tested here).
 */
describe("example intent coverage in instructions", () => {
  it("covers Huracán price vs full breakdown intents", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /how much/i);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /tell me everything/i);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /go in depth/i);
  });

  it("covers math-minimal and close-app action brevity", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /yes or no/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Calculator closed/);
  });

  it("covers research + detailed compare appropriateness", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Research depth/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /compare/i);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /explicitly multi-part/);
  });
});
