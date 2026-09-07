/**
 * Controlled fetch for research/download — redirect limits + SSRF re-check.
 */
import { assertPublicHttpUrl, isBlockedHostname } from "./ssrf";

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 5;
export const USER_AGENT =
  "AurumAssistant/1.0 (+https://github.com/JragonRIP/aurum-assistant; research)";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_URL"
      | "SSRF_BLOCKED"
      | "REDIRECT_LIMIT"
      | "TIMEOUT"
      | "HTTP_ERROR"
      | "UNSUPPORTED_TYPE"
      | "TOO_LARGE",
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export async function safeFetch(
  rawUrl: string,
  opts?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    accept?: string;
    method?: "GET" | "HEAD";
  },
): Promise<{
  url: string;
  status: number;
  headers: Headers;
  body: Buffer;
}> {
  let current = assertPublicHttpUrl(rawUrl);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? 8 * 1024 * 1024;
  const method = opts?.method ?? "GET";

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    opts?.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(current.toString(), {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            opts?.accept ??
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
        },
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) {
          throw new SafeFetchError("Redirect without location", "HTTP_ERROR");
        }
        if (hop === MAX_REDIRECTS) {
          throw new SafeFetchError("Too many redirects", "REDIRECT_LIMIT");
        }
        const next = new URL(loc, current);
        if (isBlockedHostname(next.hostname)) {
          throw new SafeFetchError(
            "Redirect target is not allowed",
            "SSRF_BLOCKED",
          );
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new SafeFetchError("Invalid redirect protocol", "INVALID_URL");
        }
        current = next;
        continue;
      }

      if (!res.ok) {
        throw new SafeFetchError(`HTTP ${res.status}`, "HTTP_ERROR");
      }

      if (method === "HEAD") {
        return {
          url: current.toString(),
          status: res.status,
          headers: res.headers,
          body: Buffer.alloc(0),
        };
      }

      const lenHeader = res.headers.get("content-length");
      if (lenHeader && Number(lenHeader) > maxBytes) {
        throw new SafeFetchError("File too large", "TOO_LARGE");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > maxBytes) {
          throw new SafeFetchError("File too large", "TOO_LARGE");
        }
        return {
          url: current.toString(),
          status: res.status,
          headers: res.headers,
          body: Buffer.from(ab),
        };
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          throw new SafeFetchError("File too large", "TOO_LARGE");
        }
        chunks.push(value);
      }
      return {
        url: current.toString(),
        status: res.status,
        headers: res.headers,
        body: Buffer.concat(chunks.map((c) => Buffer.from(c))),
      };
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        throw new SafeFetchError("Timed out", "TIMEOUT");
      }
      if (err instanceof Error && err.message === "INVALID_URL") {
        throw new SafeFetchError("Invalid URL", "INVALID_URL");
      }
      if (err instanceof Error && err.message === "SSRF_BLOCKED") {
        throw new SafeFetchError("Target not allowed", "SSRF_BLOCKED");
      }
      throw new SafeFetchError(
        err instanceof Error ? err.message.slice(0, 120) : "Fetch failed",
        "HTTP_ERROR",
      );
    } finally {
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw new SafeFetchError("Too many redirects", "REDIRECT_LIMIT");
}
