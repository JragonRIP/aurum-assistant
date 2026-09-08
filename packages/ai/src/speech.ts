/**
 * Compatibility spoken-form helpers.
 * All assistant TTS must go through prepareSpokenText — this wrapper keeps
 * existing call sites on one pipeline.
 */
import { prepareSpokenText } from "./prepare-spoken";
import {
  speakClockTimes,
  speakSimpleDates,
} from "./speech-text";
import type { PronunciationEntry, PronunciationPreference } from "./spoken-pronunciation";
import type { PreferredAddress, PreferredAddressMode } from "./spoken-address";

export type BuildSpeechOptions = {
  maxChars?: number;
  pronunciation?: PronunciationPreference;
  customPronunciations?: PronunciationEntry[];
  skipPronunciation?: boolean;
  preferredAddress?: PreferredAddress | PreferredAddressMode;
  skipAddress?: boolean;
  skipSimplification?: boolean;
  addressAlreadyUsed?: boolean;
  alreadyPrepared?: boolean;
  detailMode?: "concise" | "read_all";
  userMessage?: string;
  origin?: "ptt" | "stream" | "ack" | "tool" | "test_voice" | "final";
  logSpokenString?: boolean;
};

export function buildSpeechResponse(
  text: string,
  opts?: BuildSpeechOptions,
): string {
  if (opts?.alreadyPrepared) return text.trim();
  return prepareSpokenText({
    text,
    maxChars: opts?.maxChars,
    pronunciation: opts?.pronunciation,
    customPronunciations: opts?.customPronunciations,
    skipPronunciation: opts?.skipPronunciation,
    preferredAddress: opts?.preferredAddress,
    skipAddress: opts?.skipAddress,
    skipSimplification: opts?.skipSimplification,
    addressAlreadyUsed: opts?.addressAlreadyUsed,
    detailMode: opts?.detailMode,
    userMessage: opts?.userMessage,
    origin: opts?.origin ?? "final",
    logSpokenString: opts?.logSpokenString,
  }).spoken;
}

export { speakClockTimes, speakSimpleDates };
