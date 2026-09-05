/**
 * Reusable AI provider error abstraction.
 * Designed so Gemini (now) and OpenAI (later) share retry/classification rules.
 */

export type AIProviderName = "gemini" | "openai" | "unknown";

export type ProviderErrorKind =
  | "transient"
  | "auth"
  | "invalid_request"
  | "cancelled"
  | "unknown";

export const AI_PROVIDER_UNAVAILABLE_MESSAGE =
  "Aurum's AI provider is temporarily unavailable. Try again in a moment.";

export class AIProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: AIProviderName;
  readonly httpStatus: number | undefined;
  readonly requestId: string | undefined;
  readonly retryable: boolean;
  readonly code: string | undefined;

  constructor(options: {
    message: string;
    kind: ProviderErrorKind;
    provider: AIProviderName;
    httpStatus?: number;
    requestId?: string;
    retryable: boolean;
    code?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AIProviderError";
    this.kind = options.kind;
    this.provider = options.provider;
    this.httpStatus = options.httpStatus;
    this.requestId = options.requestId;
    this.retryable = options.retryable;
    this.code = options.code;
  }

  /** Safe message for clients — never raw provider JSON */
  toUserMessage(): string {
    if (this.kind === "transient") {
      return AI_PROVIDER_UNAVAILABLE_MESSAGE;
    }
    if (this.kind === "auth") {
      return "AI authentication failed. Check the server API key configuration.";
    }
    if (this.kind === "cancelled") {
      return "Generation stopped.";
    }
    if (this.kind === "invalid_request") {
      return "Aurum could not complete that request. Please try again.";
    }
    return "Aurum could not reach the AI provider. Please try again.";
  }
}

interface ParsedProviderPayload {
  httpStatus?: number;
  statusText?: string;
  message?: string;
  requestId?: string;
  code?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function extractPayload(err: unknown): ParsedProviderPayload {
  const result: ParsedProviderPayload = {};
  const obj = asRecord(err);

  if (obj) {
    if (typeof obj.status === "number") result.httpStatus = obj.status;
    if (typeof obj.statusCode === "number") result.httpStatus = obj.statusCode;
    if (typeof obj.code === "number") result.httpStatus = obj.code;
    if (typeof obj.code === "string") result.code = obj.code;
    if (typeof obj.requestId === "string") result.requestId = obj.requestId;
    if (typeof obj.request_id === "string") result.requestId = obj.request_id;

    const nestedError = asRecord(obj.error);
    if (nestedError) {
      if (typeof nestedError.code === "number") {
        result.httpStatus = nestedError.code;
      }
      if (typeof nestedError.status === "string") {
        result.statusText = nestedError.status;
      }
      if (typeof nestedError.message === "string") {
        result.message = nestedError.message;
      }
    }
  }

  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : undefined;

  if (message) {
    result.message ??= message;
    const jsonStart = message.indexOf("{");
    if (jsonStart >= 0) {
      const parsed = parseJsonObject(message.slice(jsonStart));
      const errorNode = asRecord(parsed?.error) ?? parsed;
      if (errorNode) {
        if (typeof errorNode.code === "number") {
          result.httpStatus ??= errorNode.code;
        }
        if (typeof errorNode.status === "string") {
          result.statusText ??= errorNode.status;
        }
        if (typeof errorNode.message === "string") {
          result.message = errorNode.message;
        }
      }
    }

    const httpMatch = message.match(/\b(5\d\d|4\d\d)\b/);
    if (httpMatch && result.httpStatus == null) {
      result.httpStatus = Number(httpMatch[1]);
    }
  }

  return result;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError" || name === "APIUserAbortError";
}

function isNetworkTimeout(err: unknown, message: string): boolean {
  const lower = message.toLowerCase();
  if (
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up") ||
    lower.includes("timeout")
  ) {
    return true;
  }
  const code = asRecord(err)?.code;
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND"
  );
}

/**
 * Classify an unknown provider failure into a structured AIProviderError.
 */
export function classifyProviderError(
  err: unknown,
  provider: AIProviderName = "unknown",
): AIProviderError {
  if (err instanceof AIProviderError) {
    return err;
  }

  if (isAbortError(err)) {
    return new AIProviderError({
      message: "Request cancelled",
      kind: "cancelled",
      provider,
      retryable: false,
      code: "cancelled",
      cause: err,
    });
  }

  const payload = extractPayload(err);
  const status = payload.httpStatus;
  const statusText = (payload.statusText ?? "").toUpperCase();
  const message = payload.message ?? "AI provider request failed";
  const combined = `${statusText} ${message}`.toUpperCase();

  if (
    status === 401 ||
    status === 403 ||
    combined.includes("API KEY") ||
    combined.includes("UNAUTHENTICATED") ||
    combined.includes("PERMISSION_DENIED")
  ) {
    return new AIProviderError({
      message,
      kind: "auth",
      provider,
      httpStatus: status,
      requestId: payload.requestId,
      retryable: false,
      code: payload.code ?? (statusText || "auth"),
      cause: err,
    });
  }

  if (
    status === 400 ||
    status === 404 ||
    status === 422 ||
    statusText === "INVALID_ARGUMENT" ||
    statusText === "FAILED_PRECONDITION" ||
    combined.includes("MALFORMED")
  ) {
    return new AIProviderError({
      message,
      kind: "invalid_request",
      provider,
      httpStatus: status,
      requestId: payload.requestId,
      retryable: false,
      code: payload.code ?? (statusText || "invalid_request"),
      cause: err,
    });
  }

  const transientByStatus =
    status === 503 ||
    status === 500 ||
    status === 502 ||
    status === 504 ||
    status === 429;

  const transientByText =
    statusText === "UNAVAILABLE" ||
    combined.includes("UNAVAILABLE") ||
    combined.includes("RESOURCE_EXHAUSTED") ||
    isNetworkTimeout(err, message);

  if (transientByStatus || transientByText) {
    return new AIProviderError({
      message,
      kind: "transient",
      provider,
      httpStatus: status ?? (statusText === "UNAVAILABLE" ? 503 : undefined),
      requestId: payload.requestId,
      retryable: true,
      code: payload.code ?? (statusText || "transient"),
      cause: err,
    });
  }

  return new AIProviderError({
    message,
    kind: "unknown",
    provider,
    httpStatus: status,
    requestId: payload.requestId,
    retryable: false,
    code: payload.code ?? "unknown",
    cause: err,
  });
}

export interface ProviderAttemptLog {
  provider: AIProviderName;
  model: string;
  attempt: number;
  maxAttempts: number;
  httpStatus?: number;
  latencyMs: number;
  requestId?: string;
  retryable: boolean;
  kind: ProviderErrorKind;
  /** Sanitized short message — never includes secrets */
  errorSummary: string;
}

export function logProviderAttempt(info: ProviderAttemptLog): void {
  console.error("[aurum:ai-provider]", {
    provider: info.provider,
    model: info.model,
    attempt: info.attempt,
    maxAttempts: info.maxAttempts,
    httpStatus: info.httpStatus ?? null,
    latencyMs: info.latencyMs,
    requestId: info.requestId ?? null,
    retryable: info.retryable,
    kind: info.kind,
    error: info.errorSummary.slice(0, 300),
  });
}
