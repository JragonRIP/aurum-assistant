/**
 * Client/server shared helpers for separating tool success from final AI response.
 */

export type FinalResponseStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type StreamOutcome = {
  actionsCommitted: boolean;
  finalResponseStatus: FinalResponseStatus;
  usedFallbackResponse: boolean;
  allowFullRetry: boolean;
  warning?: string;
};

export const COMMITTED_ACTION_RESPONSE_WARNING =
  "Aurum completed the action, but couldn't generate a final response.";

export function buildStreamOutcome(opts: {
  actionsCommitted: boolean;
  finalResponseStatus: FinalResponseStatus;
  usedFallbackResponse: boolean;
  cancelled?: boolean;
}): StreamOutcome {
  const allowFullRetry =
    !opts.actionsCommitted &&
    !opts.cancelled &&
    opts.finalResponseStatus !== "cancelled";

  const warning =
    opts.actionsCommitted && opts.finalResponseStatus === "failed"
      ? COMMITTED_ACTION_RESPONSE_WARNING
      : undefined;

  return {
    actionsCommitted: opts.actionsCommitted,
    finalResponseStatus: opts.finalResponseStatus,
    usedFallbackResponse: opts.usedFallbackResponse,
    allowFullRetry,
    warning,
  };
}

export type ClientFailureHandling = {
  /** Generic full-request failure UI */
  showFullError: boolean;
  errorMessage: string | null;
  /** Soft non-destructive notice after committed tools */
  responseWarning: string | null;
  allowFullRetry: boolean;
  /** Preserve ActionStatus / surface; do not flip tools to failed */
  preserveCommittedActions: boolean;
};

/**
 * Late SSE `error` must not erase already-committed tool success.
 */
export function resolveClientStreamError(opts: {
  errorMessage: string;
  actionsCommitted?: boolean;
  allowFullRetry?: boolean;
  /** Client already saw tool_succeeded in this generation */
  sawToolSucceeded?: boolean;
}): ClientFailureHandling {
  const committed =
    Boolean(opts.actionsCommitted) || Boolean(opts.sawToolSucceeded);

  if (committed) {
    return {
      showFullError: false,
      errorMessage: null,
      responseWarning: COMMITTED_ACTION_RESPONSE_WARNING,
      allowFullRetry: false,
      preserveCommittedActions: true,
    };
  }

  return {
    showFullError: true,
    errorMessage: opts.errorMessage,
    responseWarning: null,
    allowFullRetry: opts.allowFullRetry !== false,
    preserveCommittedActions: false,
  };
}

export function resolveClientDoneOutcome(
  outcome: StreamOutcome | undefined,
): Pick<
  ClientFailureHandling,
  "errorMessage" | "responseWarning" | "allowFullRetry" | "showFullError"
> {
  if (!outcome) {
    return {
      showFullError: false,
      errorMessage: null,
      responseWarning: null,
      allowFullRetry: true,
    };
  }

  if (outcome.actionsCommitted && outcome.finalResponseStatus === "failed") {
    return {
      showFullError: false,
      errorMessage: null,
      responseWarning: outcome.warning ?? COMMITTED_ACTION_RESPONSE_WARNING,
      allowFullRetry: false,
    };
  }

  return {
    showFullError: false,
    errorMessage: null,
    responseWarning: outcome.warning ?? null,
    allowFullRetry: outcome.allowFullRetry,
  };
}
