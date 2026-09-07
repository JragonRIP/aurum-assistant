import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSpeechResponse } from "./speech";
import {
  AURUM_SPOKEN_STYLE,
  AURUM_SYSTEM_INSTRUCTIONS,
  DEFAULT_PERSONALITY_PREFERENCES,
  DEFAULT_RESPONSE_DETAIL_PREFERENCE,
  applyTemporaryOverride,
  buildPersonalityGuidance,
  buildSystemPrompt,
  detectTemporaryToneOverride,
  inferConversationTone,
  parsePersonalityPreferences,
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

describe("example intent coverage in instructions", () => {
  it("covers Huracán price vs full breakdown intents", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /how much\?/i);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /full breakdown/);
  });
});

describe("refined Aurum personality", () => {
  it("encodes composed refined qualities without character imitation", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Exceptionally composed/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Dry wit/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Competent first, witty second/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Never imitate JARVIS/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Paul Bettany/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /copyrighted catchphrases/);
    assert.doesNotMatch(AURUM_SYSTEM_INSTRUCTIONS, /speak like JARVIS/i);
    assert.doesNotMatch(AURUM_SYSTEM_INSTRUCTIONS, /Paul Bettany voice/i);
    assert.doesNotMatch(AURUM_SYSTEM_INSTRUCTIONS, /do an Iron Man impression/i);
  });

  it("simple factual answer stays concise (instruction contract)", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Simple fact: answer only/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /"391\."/);
  });

  it("routine action stays very short", () => {
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /Routine action: "Done\."/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /"Certainly\."/);
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /"That's handled\."/);
  });

  it("harmless repeated failure may use subtle wit; first failure stays diagnostic", () => {
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /Harmless repeated failure: "It's still refusing to cooperate/,
    );
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /first failure stays mostly diagnostic/i,
    );
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /Technical issue \(first failure\)/,
    );
  });

  it("serious context suppresses humor", () => {
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /Health, safety, emotional distress, security incidents/,
    );
    assert.match(AURUM_SYSTEM_INSTRUCTIONS, /no sarcasm or humor/i);
    assert.equal(inferConversationTone("I think I was hacked and my password leaked"), "serious");
    assert.equal(
      inferConversationTone("Should I wire my life savings to this account?"),
      "serious",
    );
    const guidance = buildPersonalityGuidance({
      preferences: DEFAULT_PERSONALITY_PREFERENCES,
      tone: "serious",
    });
    assert.match(guidance, /NO sarcasm/);
    assert.match(guidance, /NO dry wit/);
  });

  it("Aurum can politely disagree", () => {
    assert.match(
      AURUM_SYSTEM_INSTRUCTIONS,
      /I wouldn't do that\. There's a cleaner option/,
    );
  });

  it('explicit "be serious" suppresses personality humor', () => {
    const override = detectTemporaryToneOverride("Be serious for now.");
    assert.ok(override);
    assert.equal(override!.temporary, true);
    assert.equal(override!.humor, "none");
    assert.equal(override!.sarcasm, "none");
    const guidance = buildPersonalityGuidance({
      preferences: DEFAULT_PERSONALITY_PREFERENCES,
      tone: "normal",
      temporaryOverride: override,
    });
    assert.match(guidance, /Humor level: none/);
    assert.match(guidance, /NO sarcasm/);
  });

  it("stored personality preferences affect later sessions", () => {
    const prefs = parsePersonalityPreferences([
      {
        canonical_key: "preference:humor_level",
        content: "User prefers more dry wit",
      },
      {
        canonical_key: "preference:formality",
        content: "User prefers a more casual tone",
      },
      {
        canonical_key: "preference:sarcasm_level",
        content: "User prefers more sarcasm",
      },
      {
        canonical_key: "preference:personality_style",
        content: "refined",
      },
    ]);
    assert.equal(prefs.humor, "more");
    assert.equal(prefs.formality, "casual");
    assert.equal(prefs.sarcasm, "more");
    assert.equal(prefs.style, "refined");

    const prompt = buildSystemPrompt({
      now: new Date("2026-09-06T12:00:00Z"),
      userMessage: "How are things?",
      personalityPreferences: prefs,
    });
    assert.match(prompt, /Humor level: more/);
    assert.match(prompt, /Formality: casual/);
  });

  it("temporary tone override does not permanently overwrite preference", () => {
    const base = parsePersonalityPreferences([
      {
        canonical_key: "preference:humor_level",
        content: "User prefers subtle humor",
      },
    ]);
    assert.equal(base.humor, "subtle");

    const temp = detectTemporaryToneOverride("Be serious for now.");
    assert.ok(temp?.temporary);
    assert.equal(temp!.permanent, false);

    const applied = applyTemporaryOverride(base, temp);
    assert.equal(applied.humor, "none");
    // Base prefs unchanged
    assert.equal(base.humor, "subtle");

    // Permanent-looking wording without "for now" may be permanent
    const perm = detectTemporaryToneOverride(
      "From now on be more sarcastic please.",
    );
    assert.ok(perm);
    assert.equal(perm!.permanent, true);
    assert.equal(perm!.temporary, false);
    assert.equal(perm!.sarcasm, "more");
  });

  it("voice speech response preserves personality without becoming verbose", () => {
    assert.match(AURUM_SPOKEN_STYLE, /MORE concise than written/);
    assert.match(AURUM_SPOKEN_STYLE, /Same Aurum personality/);
    assert.match(AURUM_SPOKEN_STYLE, /Do not imitate any actor/);

    const spoken = buildSpeechResponse(
      "Yes. Production is healthy. It finally decided to cooperate. Here is a long appendix with many details that should not all be spoken aloud in voice mode because brevity matters for TTS delivery.",
      { maxChars: 120 },
    );
    assert.ok(spoken.length <= 130);
    assert.match(spoken, /Production is healthy/);
  });

  it("no character/actor imitation instructions are introduced", () => {
    const prompt = buildSystemPrompt({
      now: new Date("2026-09-06T12:00:00Z"),
      userMessage: "Close Calculator.",
    });
    assert.doesNotMatch(prompt, /channel Paul Bettany/i);
    assert.doesNotMatch(prompt, /sound like JARVIS/i);
    assert.doesNotMatch(prompt, /do an impression/i);
    assert.match(prompt, /Never imitate JARVIS/);
    assert.match(prompt, /You are Aurum/);
  });

  it("does not expose internal mode names as user-facing labels", () => {
    const prompt = buildSystemPrompt({
      now: new Date("2026-09-06T12:00:00Z"),
      userMessage: "Deploy the migration.",
    });
    assert.match(prompt, /never name these modes to the user/i);
    assert.equal(inferConversationTone("Deploy the migration."), "focused");
    assert.equal(
      inferConversationTone("It still won't cooperate again"),
      "frustrating",
    );
  });

  it("defaults personality prefs when memories absent", () => {
    assert.deepEqual(
      parsePersonalityPreferences([]),
      DEFAULT_PERSONALITY_PREFERENCES,
    );
  });
});
