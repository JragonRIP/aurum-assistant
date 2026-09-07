/**
 * Safe extraction of Gemini TTS quota / rate-limit metadata.
 * Never returns API keys, auth headers, or full provider payloads.
 */
export type SafeQuotaViolation = {
  quotaMetric: string | null;
  quotaId: string | null;
  model: string | null;
  location: string | null;
};

export type SafeTtsQuotaInfo = {
  httpStatus: number | null;
  statusText: string | null;
  quotaMetric: string | null;
  quotaId: string | null;
  model: string | null;
  location: string | null;
  limit: number | null;
  retryDelayMs: number | null;
  isDailyQuota: boolean;
  isFreeTierMetric: boolean;
  violations: SafeQuotaViolation[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse "9h40m31.1s", "11.76s", or "34809s" into milliseconds. */
export function parseRetryDelayPhrase(raw: string): number | null {
  const text = raw.trim().replace(/\.$/, "");
  if (!text) return null;

  const plainSec = text.match(/^(\d+(?:\.\d+)?)s$/i);
  if (plainSec) return Math.round(Number(plainSec[1]) * 1000);

  let totalSec = 0;
  let matched = false;
  const h = text.match(/(\d+(?:\.\d+)?)\s*h/i);
  const m = text.match(/(\d+(?:\.\d+)?)\s*m(?![a-z])/i);
  const s = text.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (h) {
    totalSec += Number(h[1]) * 3600;
    matched = true;
  }
  if (m) {
    totalSec += Number(m[1]) * 60;
    matched = true;
  }
  if (s) {
    totalSec += Number(s[1]);
    matched = true;
  }
  if (!matched) {
    const asNum = Number(text);
    if (Number.isFinite(asNum) && asNum >= 0) return Math.round(asNum * 1000);
    return null;
  }
  return Math.round(totalSec * 1000);
}

function parseMessageBody(message: string): {
  limit: number | null;
  model: string | null;
  metric: string | null;
  retryDelayMs: number | null;
} {
  const metric =
    message.match(
      /Quota exceeded for metric:\s*([a-z0-9._/-]+)/i,
    )?.[1] ?? null;
  const limitRaw = message.match(/limit:\s*(\d+)/i)?.[1];
  const model =
    message.match(/model:\s*([a-z0-9._-]+)/i)?.[1] ?? null;
  const retryPhrase =
    message.match(/Please retry in\s*([0-9hms.\s]+)/i)?.[1] ?? null;
  return {
    metric,
    limit: limitRaw != null ? Number(limitRaw) : null,
    model,
    retryDelayMs: retryPhrase ? parseRetryDelayPhrase(retryPhrase) : null,
  };
}

function extractErrorJson(err: unknown): Record<string, unknown> | null {
  const obj = asRecord(err);
  if (obj) {
    const nested = asRecord(obj.error);
    if (nested) return nested;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  const start = message.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(message.slice(start)) as unknown;
    const root = asRecord(parsed);
    return asRecord(root?.error) ?? root;
  } catch {
    return null;
  }
}

/**
 * Extract only safe quota fields from a Gemini ApiError / RESOURCE_EXHAUSTED body.
 */
export function extractSafeTtsQuotaInfo(err: unknown): SafeTtsQuotaInfo {
  const empty: SafeTtsQuotaInfo = {
    httpStatus: null,
    statusText: null,
    quotaMetric: null,
    quotaId: null,
    model: null,
    location: null,
    limit: null,
    retryDelayMs: null,
    isDailyQuota: false,
    isFreeTierMetric: false,
    violations: [],
  };

  const errorNode = extractErrorJson(err);
  const message =
    (typeof errorNode?.message === "string" ? errorNode.message : null) ||
    (err instanceof Error ? err.message : "") ||
    "";
  const fromMessage = parseMessageBody(message);

  const status =
    typeof (err as { status?: number })?.status === "number"
      ? (err as { status: number }).status
      : typeof errorNode?.code === "number"
        ? errorNode.code
        : null;
  const statusText =
    typeof errorNode?.status === "string" ? errorNode.status : null;

  const details = Array.isArray(errorNode?.details)
    ? (errorNode.details as unknown[])
    : [];

  const violations: SafeQuotaViolation[] = [];
  let retryDelayMs = fromMessage.retryDelayMs;

  for (const detail of details) {
    const d = asRecord(detail);
    if (!d) continue;
    const type = typeof d["@type"] === "string" ? d["@type"] : "";
    if (type.includes("QuotaFailure") && Array.isArray(d.violations)) {
      for (const v of d.violations) {
        const vr = asRecord(v);
        if (!vr) continue;
        const dims = asRecord(vr.quotaDimensions);
        violations.push({
          quotaMetric:
            typeof vr.quotaMetric === "string" ? vr.quotaMetric : null,
          quotaId: typeof vr.quotaId === "string" ? vr.quotaId : null,
          model: typeof dims?.model === "string" ? dims.model : null,
          location: typeof dims?.location === "string" ? dims.location : null,
        });
      }
    }
    if (type.includes("RetryInfo")) {
      const delay =
        typeof d.retryDelay === "string"
          ? d.retryDelay
          : typeof d.retry_delay === "string"
            ? d.retry_delay
            : null;
      if (delay) {
        const parsed = parseRetryDelayPhrase(delay);
        if (parsed != null) retryDelayMs = parsed;
      }
    }
  }

  const primary = violations[0];
  const quotaMetric = primary?.quotaMetric ?? fromMessage.metric;
  const quotaId = primary?.quotaId ?? null;
  const model = primary?.model ?? fromMessage.model;
  const location = primary?.location ?? null;
  const isDailyQuota = Boolean(
    quotaMetric?.includes("per_day") ||
      quotaId?.toLowerCase().includes("perday") ||
      (retryDelayMs != null && retryDelayMs >= 60 * 60 * 1000),
  );
  const isFreeTierMetric = Boolean(
    quotaMetric?.includes("free_tier") ||
      quotaId?.toLowerCase().includes("freetier"),
  );

  return {
    httpStatus: status,
    statusText,
    quotaMetric,
    quotaId,
    model,
    location,
    limit: fromMessage.limit,
    retryDelayMs,
    isDailyQuota,
    isFreeTierMetric,
    violations,
  };
}

/** Loggable subset — no message body, no secrets. */
export function safeQuotaLogFields(info: SafeTtsQuotaInfo): Record<string, unknown> {
  return {
    quota_metric: info.quotaMetric,
    quota_id: info.quotaId,
    quota_model: info.model,
    quota_location: info.location,
    quota_limit: info.limit,
    retry_delay_ms: info.retryDelayMs,
    is_daily_quota: info.isDailyQuota,
    is_free_tier_metric: info.isFreeTierMetric,
    violation_count: info.violations.length,
  };
}
