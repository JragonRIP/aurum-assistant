/**
 * Canonical spoken-text pipeline for every local assistant utterance.
 *
 * display/assistant text
 *   → spoken simplification
 *   → preferred-address insertion
 *   → pronunciation normalization
 *   → Kokoro
 *
 * Display / stored / tool text must never be passed through here for UI.
 */
import {
  speakClockTimes,
  speakSimpleDates,
  stripSpeechMarkup,
} from "./speech-text";
import {
  applySpokenAddress,
  DEFAULT_PREFERRED_ADDRESS,
  resolveAddressToken,
  spokenAlreadyHasAddress,
  type PreferredAddress,
  type PreferredAddressMode,
} from "./spoken-address";
import {
  applySpokenPronunciation,
  type PronunciationEntry,
  type PronunciationPreference,
} from "./spoken-pronunciation";
import {
  simplifySpokenText,
  wantsFullSpokenReadback,
  type SpokenDetailMode,
  type SpokenToolHint,
} from "./spoken-simplify";

export type SpokenOrigin =
  | "ptt"
  | "stream"
  | "ack"
  | "tool"
  | "test_voice"
  | "final";

export type PrepareSpokenInput = {
  text: string;
  origin?: SpokenOrigin;
  turnId?: string | number;
  toolHints?: SpokenToolHint[];
  preferredAddress?: PreferredAddress | PreferredAddressMode;
  pronunciation?: PronunciationPreference;
  customPronunciations?: PronunciationEntry[];
  detailMode?: SpokenDetailMode;
  userMessage?: string;
  addressAlreadyUsed?: boolean;
  skipSimplification?: boolean;
  skipAddress?: boolean;
  skipPronunciation?: boolean;
  maxChars?: number;
  /** When true, include spoken text in the log payload (dev only). */
  logSpokenString?: boolean;
};

export type PrepareSpokenResult = {
  spoken: string;
  displayLength: number;
  spokenLength: number;
  addressApplied: boolean;
  simplified: boolean;
  pronunciationApplied: boolean;
  prepareMs: number;
};

export function prepareSpokenText(input: PrepareSpokenInput): PrepareSpokenResult {
  const started = Date.now();
  const display = input.text ?? "";
  const displayLength = display.trim().length;

  let t = stripSpeechMarkup(display);
  if (!t) {
    return {
      spoken: "",
      displayLength,
      spokenLength: 0,
      addressApplied: false,
      simplified: false,
      pronunciationApplied: false,
      prepareMs: Date.now() - started,
    };
  }

  const detailMode: SpokenDetailMode =
    input.detailMode ??
    (wantsFullSpokenReadback(input.userMessage) ? "read_all" : "concise");

  let simplified = false;
  if (!input.skipSimplification) {
    const slim = simplifySpokenText(t, {
      detailMode,
      toolHints: input.toolHints,
      voiceOrigin: input.origin !== "test_voice",
    });
    t = slim.text;
    simplified = slim.simplified;
  }

  t = speakSimpleDates(t);
  // Keep a single clock like "10:34 PM" for short factual answers.
  // Convert clocks in longer multi-time replies so they speak naturally.
  const clockCount = (t.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length;
  if (clockCount >= 2 || /today|schedule|calendar|meeting|class|call/i.test(t)) {
    t = speakClockTimes(t);
  }

  const address = input.preferredAddress ?? DEFAULT_PREFERRED_ADDRESS;
  const token = resolveAddressToken(address);

  let addressApplied = false;
  const alreadyHas = token ? spokenAlreadyHasAddress(t, token) : false;
  if (
    !input.skipAddress &&
    !input.addressAlreadyUsed &&
    token &&
    !alreadyHas
  ) {
    const next = applySpokenAddress(t, address);
    addressApplied = next !== t;
    t = next;
  }

  let pronunciationApplied = false;
  if (!input.skipPronunciation) {
    const before = t;
    t = applySpokenPronunciation(t, {
      preference: input.pronunciation ?? "americanized_british",
      custom: input.customPronunciations,
    });
    pronunciationApplied = t !== before;
  }

  const max = input.maxChars ?? (detailMode === "read_all" ? 800 : 320);
  if (t.length > max) {
    const parts = t.split(/(?<=[.!?])\s+/);
    let out = "";
    for (const p of parts) {
      const next = out ? `${out} ${p}` : p;
      if (next.length > max) break;
      out = next;
      if (detailMode !== "read_all" && out.length >= Math.min(160, max)) break;
    }
    t = out || `${t.slice(0, max - 1).trim()}…`;
  }

  const prepareMs = Date.now() - started;
  logPrepare({
    origin: input.origin ?? "final",
    turnId: input.turnId,
    displayLength,
    spokenLength: t.length,
    addressApplied: addressApplied || alreadyHas,
    simplified,
    pronunciationApplied,
    prepareMs,
    spoken: input.logSpokenString ? t : undefined,
  });

  return {
    spoken: t,
    displayLength,
    spokenLength: t.length,
    addressApplied: addressApplied || alreadyHas,
    simplified,
    pronunciationApplied,
    prepareMs,
  };
}

function logPrepare(fields: {
  origin: string;
  turnId?: string | number;
  displayLength: number;
  spokenLength: number;
  addressApplied: boolean;
  simplified: boolean;
  pronunciationApplied: boolean;
  prepareMs: number;
  spoken?: string;
}): void {
  const payload: Record<string, string | number | boolean | null> = {
    stage: "prepare",
    origin: fields.origin,
    turn_id: fields.turnId ?? null,
    display_length: fields.displayLength,
    spoken_length: fields.spokenLength,
    address_applied: fields.addressApplied,
    simplified: fields.simplified,
    pronunciation_applied: fields.pronunciationApplied,
    prepare_ms: fields.prepareMs,
  };
  if (fields.spoken != null) {
    payload.spoken = fields.spoken.slice(0, 240);
  }
  if (!process.env.NODE_TEST_CONTEXT) {
    console.info("[aurum:voice:speech]", payload);
  }
}
