/**
 * Image search via DuckDuckGo i.js (vqd token) — no browser automation.
 */
import { safeFetch, SafeFetchError, USER_AGENT } from "../safe-fetch";
import { sanitizeQuery } from "./search";

export type ImageSearchHit = {
  title: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  sourcePageUrl: string | null;
  width: number | null;
  height: number | null;
  domain: string;
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchVqd(query: string, signal?: AbortSignal): Promise<string | null> {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  try {
    const { body } = await safeFetch(url, {
      signal,
      accept: "text/html",
      maxBytes: 1_500_000,
    });
    const html = body.toString("utf8");
    const m =
      /vqd(?:\\?|['"])?[:=]\s*['"]?([\d-]+)/i.exec(html) ||
      /vqd=([\d-]+)/i.exec(html);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function searchImages(
  queryRaw: string,
  signal?: AbortSignal,
): Promise<{ query: string; results: ImageSearchHit[] }> {
  const query = sanitizeQuery(queryRaw);
  if (!query) {
    throw new SafeFetchError("Empty query", "INVALID_URL");
  }

  const vqd = await fetchVqd(query, signal);
  if (!vqd) {
    // Soft empty — caller distinguishes provider failure vs zero results when fetch throws
    return { query, results: [] };
  }

  const api = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,,,&p=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(api, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Referer: "https://duckduckgo.com/",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new SafeFetchError(`HTTP ${res.status}`, "HTTP_ERROR");
    }
    const json = (await res.json()) as {
      results?: Array<{
        title?: string;
        image?: string;
        thumbnail?: string;
        url?: string;
        width?: number;
        height?: number;
      }>;
    };
    const results: ImageSearchHit[] = [];
    for (const r of json.results ?? []) {
      const imageUrl = (r.image ?? "").trim();
      if (!imageUrl.startsWith("http")) continue;
      results.push({
        title: (r.title ?? "Image").slice(0, 200),
        imageUrl,
        thumbnailUrl: r.thumbnail?.startsWith("http") ? r.thumbnail : null,
        sourcePageUrl: r.url?.startsWith("http") ? r.url : null,
        width: typeof r.width === "number" ? r.width : null,
        height: typeof r.height === "number" ? r.height : null,
        domain: domainOf(r.url || imageUrl),
      });
      if (results.length >= 10) break;
    }
    return { query, results };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
