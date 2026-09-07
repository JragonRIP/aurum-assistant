/**
 * Web search provider abstraction — harden DDG HTML + optional Brave.
 */
import { safeFetch, SafeFetchError, USER_AGENT } from "../safe-fetch";

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
};

const MAX_QUERY_LEN = 200;
const MAX_RESULTS = 8;

export function sanitizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LEN);
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function unwrapDdgRedirect(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return u.toString();
  } catch {
    return href;
  }
}

/** Parse DuckDuckGo HTML results with multiple markup shapes. */
export function parseDuckDuckGoHtml(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const seen = new Set<string>();

  const push = (rawUrl: string, titleRaw: string, snippetRaw = "") => {
    const url = unwrapDdgRedirect(decodeEntities(rawUrl).trim());
    const title = stripHtml(titleRaw).trim();
    const snippet = stripHtml(snippetRaw).trim().slice(0, 280);
    if (!url.startsWith("http") || !title) return;
    if (seen.has(url)) return;
    seen.add(url);
    hits.push({ title, url, snippet, domain: domainOf(url) });
  };

  // Classic result__a
  const reA =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,800}?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(html)) && hits.length < MAX_RESULTS) {
    push(m[1] ?? "", m[2] ?? "", m[3] ?? "");
  }

  // Alternate: result-link / links with uddg=
  if (hits.length < 2) {
    const reUddg =
      /href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reUddg.exec(html)) && hits.length < MAX_RESULTS) {
      push(m[1] ?? "", m[2] ?? "");
    }
  }

  // Lite / serp: <a rel="nofollow" href="//duckduckgo.com/l/?uddg=...
  if (hits.length < 2) {
    const reLite =
      /<a[^>]+href="((?:https?:)?\/\/duckduckgo\.com\/l\/\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reLite.exec(html)) && hits.length < MAX_RESULTS) {
      let href = m[1] ?? "";
      if (href.startsWith("//")) href = `https:${href}`;
      push(href, m[2] ?? "");
    }
  }

  return hits.slice(0, MAX_RESULTS);
}

export interface WebSearchProvider {
  id: string;
  search(query: string, signal?: AbortSignal): Promise<WebSearchHit[]>;
}

export const duckDuckGoHtmlProvider: WebSearchProvider = {
  id: "duckduckgo_html",
  async search(query, signal) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const { body } = await safeFetch(url, {
      signal,
      accept: "text/html",
      maxBytes: 2_000_000,
    });
    return parseDuckDuckGoHtml(body.toString("utf8"));
  },
};

/** Secondary HTML endpoint (same parser). */
export const duckDuckGoLiteProvider: WebSearchProvider = {
  id: "duckduckgo_lite",
  async search(query, signal) {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const { body } = await safeFetch(url, {
      signal,
      accept: "text/html",
      maxBytes: 2_000_000,
    });
    return parseDuckDuckGoHtml(body.toString("utf8"));
  },
};

/** Optional Brave Search API when BRAVE_SEARCH_API_KEY is set. */
export const braveSearchProvider: WebSearchProvider = {
  id: "brave",
  async search(query, signal) {
    const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
    if (!key) return [];
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": key,
          "User-Agent": USER_AGENT,
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`Brave search HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };
      const out: WebSearchHit[] = [];
      for (const r of json.web?.results ?? []) {
        if (!r.url || !r.title) continue;
        out.push({
          title: r.title,
          url: r.url,
          snippet: (r.description ?? "").slice(0, 280),
          domain: domainOf(r.url),
        });
        if (out.length >= MAX_RESULTS) break;
      }
      return out;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  },
};

export function getSearchProviders(): WebSearchProvider[] {
  const providers: WebSearchProvider[] = [];
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) {
    providers.push(braveSearchProvider);
  }
  providers.push(duckDuckGoHtmlProvider, duckDuckGoLiteProvider);
  return providers;
}

export async function searchWeb(
  queryRaw: string,
  signal?: AbortSignal,
): Promise<{
  query: string;
  results: WebSearchHit[];
  provider: string;
  attempts: Array<{
    provider: string;
    ok: boolean;
    resultCount: number;
    latencyMs: number;
    error?: string;
  }>;
}> {
  const query = sanitizeQuery(queryRaw);
  if (!query) {
    throw new SafeFetchError("Empty query", "INVALID_URL");
  }

  const attempts: Array<{
    provider: string;
    ok: boolean;
    resultCount: number;
    latencyMs: number;
    error?: string;
  }> = [];
  let lastError: unknown;
  for (const provider of getSearchProviders()) {
    const started = Date.now();
    try {
      const results = await provider.search(query, signal);
      const latencyMs = Date.now() - started;
      attempts.push({
        provider: provider.id,
        ok: true,
        resultCount: results.length,
        latencyMs,
      });
      console.info("[aurum:web_search]", {
        provider: provider.id,
        attempt: attempts.length,
        status: results.length > 0 ? "hit" : "empty",
        latency_ms: latencyMs,
        fallback_used: attempts.length > 1,
      });
      if (results.length > 0) {
        return {
          query,
          results,
          provider: provider.id,
          attempts,
        };
      }
    } catch (err) {
      lastError = err;
      attempts.push({
        provider: provider.id,
        ok: false,
        resultCount: 0,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message.slice(0, 120) : "error",
      });
      console.info("[aurum:web_search]", {
        provider: provider.id,
        attempt: attempts.length,
        status: "error",
        latency_ms: Date.now() - started,
        fallback_used: true,
      });
      continue;
    }
  }

  if (lastError) throw lastError;
  return { query, results: [], provider: "none", attempts };
}
