/**
 * Overlay turn / execution snapshot — main owns lifetime; overlay is a view.
 */

export type OverlayTurnStatus =
  | "IDLE"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type OverlayTurnSnapshot = {
  executionId: string | null;
  conversationId: string | null;
  status: OverlayTurnStatus;
  activity: string | null;
  reply: string;
  warning: string | null;
  error: string | null;
  pendingApproval: {
    approvalId: string;
    tool: string;
    label: string;
    detail: string;
    confirmVerb: string;
  } | null;
  inputMode: "text" | "voice" | null;
  updatedAt: number;
};

export function emptyOverlayTurn(): OverlayTurnSnapshot {
  return {
    executionId: null,
    conversationId: null,
    status: "IDLE",
    activity: null,
    reply: "",
    warning: null,
    error: null,
    pendingApproval: null,
    inputMode: null,
    updatedAt: Date.now(),
  };
}

export function isOverlayAwaitingUserFailure(code?: string): boolean {
  return (
    code === "AMBIGUOUS_TRACK" ||
    code === "AMBIGUOUS_PLAYLIST" ||
    code === "AMBIGUOUS_MATCH" ||
    code === "MISSING_SCOPE" ||
    code === "AUTH_REVOKED" ||
    code === "TOKEN_EXPIRED" ||
    code === "NOT_CONNECTED"
  );
}

/** Soft tool failures must not force FAILED / ERROR presence. */
export function isOverlaySoftToolFailure(opts: {
  code?: string;
  tool?: string;
}): boolean {
  const code = opts.code ?? "";
  if (
    isOverlayAwaitingUserFailure(code) ||
    code === "APPROVAL_REQUIRED" ||
    code === "PLAYBACK_CHANGE_NOT_CONFIRMED" ||
    code === "RATE_LIMITED" ||
    code === "PROVIDER_UNAVAILABLE" ||
    code === "UNSUPPORTED" ||
    code === "PLAYLIST_NOT_WRITABLE" ||
    code === "TRANSIENT_FAILURE" ||
    code === "SPOTIFY_REJECTED"
  ) {
    return true;
  }
  const tool = opts.tool ?? "";
  if (tool.startsWith("web_")) return true;
  return false;
}

export function reduceOverlayTurn(
  prev: OverlayTurnSnapshot,
  event: {
    type: string;
    text?: string;
    tool?: string;
    approvalId?: string;
    executionId?: string;
    display?: { label?: string; detail?: string };
    error?: { message?: string; code?: string };
    message?: { content?: string };
    outcome?: { warning?: string };
  },
): OverlayTurnSnapshot {
  const now = Date.now();
  const next: OverlayTurnSnapshot = { ...prev, updatedAt: now };

  if (event.executionId) next.executionId = event.executionId;

  switch (event.type) {
    case "assistant_start":
    case "status":
      if (next.status === "IDLE" || next.status === "COMPLETED") {
        next.status = "RUNNING";
      }
      if (next.status === "FAILED" || next.status === "CANCELLED") {
        next.status = "RUNNING";
      }
      next.error = null;
      return next;
    case "tool_started":
    case "tool_requested":
      next.status =
        next.status === "WAITING_FOR_APPROVAL" ||
        next.status === "WAITING_FOR_USER"
          ? next.status
          : "RUNNING";
      next.activity = event.display?.label ?? next.activity;
      return next;
    case "approval_required":
      next.status = "WAITING_FOR_APPROVAL";
      next.activity = null;
      next.error = null;
      return next;
    case "clarification_needed":
      next.status = "WAITING_FOR_USER";
      next.activity = null;
      next.error = null;
      if (event.error?.message || event.display?.detail) {
        next.reply = event.display?.detail ?? event.error?.message ?? next.reply;
      }
      return next;
    case "delta":
      if (event.text) next.reply += event.text;
      next.status =
        next.status === "WAITING_FOR_APPROVAL" ||
        next.status === "WAITING_FOR_USER"
          ? next.status
          : "RUNNING";
      next.activity = null;
      return next;
    case "tool_failed": {
      if (isOverlayAwaitingUserFailure(event.error?.code)) {
        next.status = "WAITING_FOR_USER";
        next.error = null;
        if (event.error?.message) next.reply = event.error.message;
        return next;
      }
      if (isOverlaySoftToolFailure({ code: event.error?.code, tool: event.tool })) {
        next.warning =
          event.error?.message ??
          event.display?.detail ??
          next.warning;
        // Keep RUNNING/COMPLETED path — never FAILED for soft research failures
        if (next.status === "IDLE") next.status = "RUNNING";
        return next;
      }
      next.error =
        event.error?.message ?? event.display?.detail ?? "Action failed";
      next.status = "FAILED";
      next.activity = null;
      return next;
    }
    case "done":
      if (event.message?.content && !next.reply) {
        next.reply = event.message.content;
      }
      if (event.outcome?.warning) {
        next.warning = event.outcome.warning;
      }
      if (next.status === "WAITING_FOR_APPROVAL") return next;
      if (next.status === "WAITING_FOR_USER") return next;
      if (next.status === "FAILED") return next;
      next.status = "COMPLETED";
      next.activity = null;
      next.error = null;
      return next;
    case "error":
      next.status = "FAILED";
      next.error = event.error?.message ?? "Something went wrong.";
      next.activity = null;
      return next;
    default:
      return next;
  }
}

export function beginOverlayTurn(
  prev: OverlayTurnSnapshot,
  opts: {
    executionId: string;
    conversationId: string | null;
    inputMode: "text" | "voice";
  },
): OverlayTurnSnapshot {
  return {
    ...emptyOverlayTurn(),
    executionId: opts.executionId,
    conversationId: opts.conversationId ?? prev.conversationId,
    status: "RUNNING",
    inputMode: opts.inputMode,
    updatedAt: Date.now(),
  };
}

export function shouldShowIdleForTurn(turn: OverlayTurnSnapshot): boolean {
  return (
    turn.status === "IDLE" ||
    (turn.status === "COMPLETED" && !turn.reply.trim() && !turn.warning) ||
    (turn.status === "CANCELLED" && !turn.reply.trim())
  );
}
