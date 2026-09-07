/**
 * Canonical overlay submit gates — shared by typed Enter and PTT auto-submit.
 */

export type OverlaySubmitOrigin = "text" | "voice";

export type OverlaySubmitGateState = {
  text: string;
  paired: boolean;
  streaming: boolean;
  awaitingApproval: boolean;
  listening: boolean;
  transcribing: boolean;
};

export type OverlaySubmitRequest = {
  text: string;
  origin: OverlaySubmitOrigin;
};

/** Returns why submit must not start, or null when submit may proceed. */
export function overlaySubmitBlockReason(
  state: OverlaySubmitGateState,
): "empty" | "unpaired" | "busy" | null {
  const text = state.text.trim();
  if (!text) return "empty";
  if (!state.paired) return "unpaired";
  if (
    state.streaming ||
    state.awaitingApproval ||
    state.listening ||
    state.transcribing
  ) {
    return "busy";
  }
  return null;
}

export function shouldAutoSubmitVoiceTranscript(transcript: string): boolean {
  return transcript.trim().length > 0;
}
