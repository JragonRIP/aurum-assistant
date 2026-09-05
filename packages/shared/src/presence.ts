import type { PresenceState } from "./types";

/** Visual presentation of the Core. Domain state stays on PresenceState. */
export type PresencePresentation =
  | "idle"
  | "thinking"
  | "acting"
  | "responding"
  | "hold"
  | "success"
  | "error"
  | "offline"
  | "listening"
  | "speaking";

export type CoreLayoutMode = "idle" | "active";

export function coreLayoutMode(opts: {
  workspace: "home" | "session";
  streaming?: boolean;
}): CoreLayoutMode {
  if (opts.workspace === "session" || opts.streaming) return "active";
  return "idle";
}

export function derivePresencePresentation(opts: {
  state: PresenceState;
  streaming?: boolean;
  hasResponseText?: boolean;
  acting?: boolean;
  successPulse?: boolean;
}): PresencePresentation {
  const { state } = opts;
  if (opts.successPulse && state !== "ERROR" && state !== "OFFLINE") {
    return "success";
  }
  switch (state) {
    case "ERROR":
      return "error";
    case "OFFLINE":
      return "offline";
    case "WAITING_FOR_APPROVAL":
      return "hold";
    case "ACTING":
      return "acting";
    case "LISTENING":
      return "listening";
    case "SPEAKING":
      return "speaking";
    case "THINKING":
      if (opts.streaming && opts.hasResponseText && !opts.acting) {
        return "responding";
      }
      return "thinking";
    default:
      return "idle";
  }
}

/** Human status near the Core. Never invents activity. */
export function presenceStatusLabel(opts: {
  presentation: PresencePresentation;
  toolLabel?: string | null;
}): string {
  if (opts.presentation === "acting") {
    const trusted = trustedActivityCaption(opts.toolLabel);
    if (trusted) return trusted;
    return "WORKING";
  }
  switch (opts.presentation) {
    case "thinking":
      return "THINKING";
    case "responding":
      return "RESPONDING";
    case "hold":
      return "WAITING FOR APPROVAL";
    case "error":
      return "ERROR";
    case "offline":
      return "OFFLINE";
    case "listening":
      return "LISTENING";
    case "speaking":
      return "SPEAKING";
    case "success":
      return "DONE";
    default:
      return "";
  }
}

/**
 * Keep display labels that already look human.
 * Drop raw tool/function identifiers.
 */
export function trustedActivityCaption(label?: string | null): string | null {
  if (!label) return null;
  const text = label.trim();
  if (!text) return null;
  if (text === "DONE" || text === "FAILED" || text === "RESPONDING") return null;
  // Connectivity captions are reserved for real device bridge pairing/reconnect —
  // never treat listing tools or generic "devices" checks as CONNECTING.
  const upper = text.replaceAll("_", " ").toUpperCase();
  if (
    /^(CONNECTING|RECONNECTING|PAIRING|AUTHENTICATING)(\s+DEVICES?)?$/.test(
      upper,
    )
  ) {
    return upper;
  }
  if (/CHECKING DEVICES|LISTING DEVICES/.test(upper)) {
    return "LISTING DEVICES";
  }
  if (/[_./()]/.test(text) && !/\s/.test(text)) return null;
  if (/^[a-z]+[A-Z]/.test(text)) return null;
  return upper;
}

/** True only for real device-bridge connectivity, not tool listing. */
export function isConnectivityActivityCaption(
  label?: string | null,
): boolean {
  if (!label) return false;
  const upper = label.replaceAll("_", " ").trim().toUpperCase();
  return /^(CONNECTING|RECONNECTING|PAIRING|AUTHENTICATING)(\s+DEVICES?)?$/.test(
    upper,
  );
}

export function presenceShowsError(opts: {
  error: string | null | undefined;
  streaming?: boolean;
}): boolean {
  return Boolean(opts.error) && !opts.streaming;
}

export const MINI_PRESENCE_ALLOWED = false;
