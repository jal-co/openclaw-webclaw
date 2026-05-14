import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  markdownToText,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  truncateText,
  writeCache,
  withStrictWebToolsEndpoint,
} from "openclaw/plugin-sdk/provider-web-fetch";
import { wrapExternalContent, wrapWebContent } from "openclaw/plugin-sdk/security-runtime";
import {
  SsrFBlockedError,
  isBlockedHostnameOrIp,
} from "openclaw/plugin-sdk/ssrf-runtime";
import {
  resolveWebClawApiKey,
  resolveWebClawBaseUrl,
  resolveTimeoutSeconds,
  resolveOnlyMainContent,
  resolveMaxAgeMs,
} from "./config.js";

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------
const SCRAPE_CACHE = new Map<
  string,
  { value: Record<string, unknown>; expiresAt: number; insertedAt: number }
>();
const SEARCH_CACHE = new Map<
  string,
  { value: Record<string, unknown>; expiresAt: number; insertedAt: number }
>();

const DEFAULT_SEARCH_COUNT = 5;
const DEFAULT_SCRAPE_MAX_CHARS = 50_000;

// ---------------------------------------------------------------------------
// SSRF guard for scrape targets
// ---------------------------------------------------------------------------
export function assertScrapeTargetAllowed(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrFBlockedError("Invalid URL supplied to WebClaw scrape");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrFBlockedError(
      `Blocked non-HTTP(S) protocol in WebClaw scrape URL: ${parsed.protocol}`,
    );
  }
  if (isBlockedHostnameOrIp(parsed.hostname)) {
    throw new SsrFBlockedError(
      `Blocked hostname or private/internal IP in WebClaw scrape URL: ${parsed.hostname}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Shared HTTP helper
// ---------------------------------------------------------------------------
function requireApiKey(cfg?: OpenClawConfig): string {
  const apiKey = resolveWebClawApiKey(cfg);
  if (!apiKey) {
    throw new Error(
      "WebClaw needs an API key. Set WEBCLAW_API_KEY in the Gateway environment, or configure plugins.entries.webclaw.config.apiKey.",
    );
  }
  return apiKey;
}

async function postJson<T>(params: {
  baseUrl: string;
  path: string;
  apiKey: string;
  timeoutSeconds: number;
  body: Record<string, unknown>;
  label: string;
}): Promise<T> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}${params.path}`;
  return await withStrictWebToolsEndpoint(
    {
      url,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params.body),
      },
    },
    async ({ response }) => {
      if (!response.ok) {
        let detail = response.statusText || "request failed";
        try {
          const payload = (await response.json()) as Record<string, unknown>;
          if (typeof payload.error === "string") detail = payload.error;
        } catch {
          const body = await readResponseText(response, { maxBytes: 64_000 });
          if (body.text) detail = body.text;
        }
        throw new Error(
          `${params.label} API error (${response.status}): ${wrapWebContent(detail.slice(0, 1_000), "web_fetch")}`,
        );
      }
      return (await response.json()) as T;
    },
  );
}

async function getJson<T>(params: {
  baseUrl: string;
  path: string;
  apiKey: string;
  timeoutSeconds: number;
  label: string;
}): Promise<T> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}${params.path}`;
  return await withStrictWebToolsEndpoint(
    {
      url,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "GET",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
        },
      },
    },
    async ({ response }) => {
      if (!response.ok) {
        let detail = response.statusText || "request failed";
        try {
          const payload = (await response.json()) as Record<string, unknown>;
          if (typeof payload.error === "string") detail = payload.error;
        } catch {
          const body = await readResponseText(response, { maxBytes: 64_000 });
          if (body.text) detail = body.text;
        }
        throw new Error(
          `${params.label} API error (${response.status}): ${wrapWebContent(detail.slice(0, 1_000), "web_fetch")}`,
        );
      }
      return (await response.json()) as T;
    },
  );
}

// ---------------------------------------------------------------------------
// Scrape (v1)
// ---------------------------------------------------------------------------
export type WebClawScrapeParams = {
  cfg?: OpenClawConfig;
  url: string;
  formats?: string[];
  extractMode?: "markdown" | "text";
  maxChars?: number;
  onlyMainContent?: boolean;
  includeSelectors?: string[];
  excludeSelectors?: string[];
  screenshot?: boolean;
  mobile?: boolean;
  actions?: Array<Record<string, unknown>>;
  query?: string;
  timeoutSeconds?: number;
};

export async function runWebClawScrape(
  params: WebClawScrapeParams,
): Promise<Record<string, unknown>> {
  assertScrapeTargetAllowed(params.url);
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);
  const onlyMainContent = resolveOnlyMainContent(params.cfg, params.onlyMainContent);
  const extractMode = params.extractMode ?? "markdown";
  const maxChars =
    typeof params.maxChars === "number" && Number.isFinite(params.maxChars) && params.maxChars > 0
      ? Math.floor(params.maxChars)
      : DEFAULT_SCRAPE_MAX_CHARS;
  const formats = params.formats ?? ["markdown"];

  const cacheKey = normalizeCacheKey(
    JSON.stringify({
      type: "webclaw-scrape",
      url: params.url,
      formats,
      onlyMainContent,
      maxChars,
    }),
  );
  const cached = readCache(SCRAPE_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const body: Record<string, unknown> = {
    url: params.url,
    formats,
    only_main_content: onlyMainContent,
  };
  if (params.includeSelectors?.length) body.include_selectors = params.includeSelectors;
  if (params.excludeSelectors?.length) body.exclude_selectors = params.excludeSelectors;
  if (params.screenshot) body.screenshot = true;
  if (params.mobile) body.mobile = true;
  if (params.actions?.length) body.actions = params.actions;
  if (params.query) body.query = params.query;

  const payload = await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/scrape",
    apiKey,
    timeoutSeconds,
    body,
    label: "WebClaw Scrape",
  });

  const rawText =
    extractMode === "text"
      ? markdownToText(
          (typeof payload.markdown === "string" && payload.markdown) ||
            (typeof payload.text === "string" && payload.text) ||
            "",
        )
      : (typeof payload.markdown === "string" && payload.markdown) ||
        (typeof payload.llm === "string" && payload.llm) ||
        (typeof payload.text === "string" && payload.text) ||
        "";

  const truncated = truncateText(rawText, maxChars);
  const metadata =
    payload.metadata && typeof payload.metadata === "object"
      ? (payload.metadata as Record<string, unknown>)
      : undefined;

  const result: Record<string, unknown> = {
    url: params.url,
    finalUrl: params.url,
    title: metadata?.title
      ? wrapExternalContent(String(metadata.title), { source: "web_fetch", includeWarning: false })
      : undefined,
    extractor: "webclaw",
    extractMode,
    externalContent: { untrusted: true, source: "web_fetch", wrapped: true },
    truncated: truncated.truncated,
    rawLength: rawText.length,
    text: wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false }),
  };

  // Pass through YouTube data if present
  if (payload.youtube) result.youtube = payload.youtube;
  if (typeof payload.transcript === "string") result.transcript = payload.transcript;
  if (typeof payload.query_answer === "string") {
    result.queryAnswer = wrapWebContent(payload.query_answer, "web_fetch");
  }
  if (typeof payload.screenshot === "string") result.screenshot = payload.screenshot;

  writeCache(SCRAPE_CACHE, cacheKey, result, resolveCacheTtlMs(undefined, DEFAULT_CACHE_TTL_MINUTES));
  return result;
}

// ---------------------------------------------------------------------------
// Search (v1)
// ---------------------------------------------------------------------------
export type WebClawSearchParams = {
  cfg?: OpenClawConfig;
  query: string;
  count?: number;
  scrape?: boolean;
  formats?: string[];
  country?: string;
  lang?: string;
  timeoutSeconds?: number;
};

export async function runWebClawSearch(
  params: WebClawSearchParams,
): Promise<Record<string, unknown>> {
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);
  const count =
    typeof params.count === "number" && Number.isFinite(params.count)
      ? Math.max(1, Math.min(10, Math.floor(params.count)))
      : DEFAULT_SEARCH_COUNT;
  const scrape = params.scrape ?? true;

  const cacheKey = normalizeCacheKey(
    JSON.stringify({
      type: "webclaw-search",
      q: params.query,
      count,
      scrape,
    }),
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const body: Record<string, unknown> = {
    query: params.query,
    num_results: count,
    scrape,
  };
  if (params.formats?.length) body.formats = params.formats;
  if (params.country) body.country = params.country;
  if (params.lang) body.lang = params.lang;

  const start = Date.now();
  const payload = await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/search",
    apiKey,
    timeoutSeconds,
    body,
    label: "WebClaw Search",
  });

  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const result: Record<string, unknown> = {
    query: params.query,
    provider: "webclaw",
    count: rawResults.length,
    tookMs: Date.now() - start,
    externalContent: { untrusted: true, source: "web_search", provider: "webclaw", wrapped: true },
    results: rawResults.map((entry: Record<string, unknown>) => ({
      title: entry.title ? wrapWebContent(String(entry.title), "web_search") : "",
      url: entry.url || "",
      description: entry.snippet ? wrapWebContent(String(entry.snippet), "web_search") : "",
      ...(scrape && entry.markdown
        ? { content: wrapWebContent(String(entry.markdown), "web_search") }
        : {}),
    })),
  };

  writeCache(SEARCH_CACHE, cacheKey, result, resolveCacheTtlMs(undefined, DEFAULT_CACHE_TTL_MINUTES));
  return result;
}

// ---------------------------------------------------------------------------
// Crawl (v1) — async job
// ---------------------------------------------------------------------------
export type WebClawCrawlParams = {
  cfg?: OpenClawConfig;
  url: string;
  maxDepth?: number;
  maxPages?: number;
  useSitemap?: boolean;
  includePaths?: string[];
  excludePaths?: string[];
  timeoutSeconds?: number;
};

export async function startWebClawCrawl(
  params: WebClawCrawlParams,
): Promise<Record<string, unknown>> {
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  const body: Record<string, unknown> = { url: params.url };
  if (typeof params.maxDepth === "number") body.max_depth = params.maxDepth;
  if (typeof params.maxPages === "number") body.max_pages = params.maxPages;
  if (params.useSitemap) body.use_sitemap = true;
  if (params.includePaths?.length) body.include_paths = params.includePaths;
  if (params.excludePaths?.length) body.exclude_paths = params.excludePaths;

  return await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/crawl",
    apiKey,
    timeoutSeconds,
    body,
    label: "WebClaw Crawl",
  });
}

export async function getWebClawCrawlStatus(params: {
  cfg?: OpenClawConfig;
  crawlId: string;
  timeoutSeconds?: number;
}): Promise<Record<string, unknown>> {
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  return await getJson<Record<string, unknown>>({
    baseUrl,
    path: `/v1/crawl/${encodeURIComponent(params.crawlId)}`,
    apiKey,
    timeoutSeconds,
    label: "WebClaw Crawl Status",
  });
}

// ---------------------------------------------------------------------------
// Extract (v1) — LLM-powered schema/prompt extraction
// ---------------------------------------------------------------------------
export type WebClawExtractParams = {
  cfg?: OpenClawConfig;
  url: string;
  schema?: Record<string, unknown>;
  prompt?: string;
  timeoutSeconds?: number;
};

export async function runWebClawExtract(
  params: WebClawExtractParams,
): Promise<Record<string, unknown>> {
  assertScrapeTargetAllowed(params.url);
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  const body: Record<string, unknown> = { url: params.url };
  if (params.schema) body.schema = params.schema;
  if (params.prompt) body.prompt = params.prompt;

  return await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/extract",
    apiKey,
    timeoutSeconds,
    body,
    label: "WebClaw Extract",
  });
}

// ---------------------------------------------------------------------------
// Summarize (v1)
// ---------------------------------------------------------------------------
export type WebClawSummarizeParams = {
  cfg?: OpenClawConfig;
  url: string;
  sentences?: number;
  timeoutSeconds?: number;
};

export async function runWebClawSummarize(
  params: WebClawSummarizeParams,
): Promise<Record<string, unknown>> {
  assertScrapeTargetAllowed(params.url);
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  const body: Record<string, unknown> = { url: params.url };
  if (typeof params.sentences === "number") body.sentences = params.sentences;

  return await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/summarize",
    apiKey,
    timeoutSeconds,
    body,
    label: "WebClaw Summarize",
  });
}

// ---------------------------------------------------------------------------
// Diff (v1) — content change tracking
// ---------------------------------------------------------------------------
export type WebClawDiffParams = {
  cfg?: OpenClawConfig;
  url: string;
  snapshot: Record<string, unknown>;
  timeoutSeconds?: number;
};

export async function runWebClawDiff(
  params: WebClawDiffParams,
): Promise<Record<string, unknown>> {
  assertScrapeTargetAllowed(params.url);
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  return await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/diff",
    apiKey,
    timeoutSeconds,
    body: { url: params.url, snapshot: params.snapshot },
    label: "WebClaw Diff",
  });
}

// ---------------------------------------------------------------------------
// Map (v1) — sitemap discovery
// ---------------------------------------------------------------------------
export type WebClawMapParams = {
  cfg?: OpenClawConfig;
  url: string;
  timeoutSeconds?: number;
};

export async function runWebClawMap(
  params: WebClawMapParams,
): Promise<Record<string, unknown>> {
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  return await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/map",
    apiKey,
    timeoutSeconds,
    body: { url: params.url },
    label: "WebClaw Map",
  });
}

// ---------------------------------------------------------------------------
// Batch (v1) — multi-URL extraction
// ---------------------------------------------------------------------------
export type WebClawBatchParams = {
  cfg?: OpenClawConfig;
  urls: string[];
  formats?: string[];
  concurrency?: number;
  timeoutSeconds?: number;
};

export async function runWebClawBatch(
  params: WebClawBatchParams,
): Promise<Record<string, unknown>> {
  for (const url of params.urls) assertScrapeTargetAllowed(url);
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  const body: Record<string, unknown> = { urls: params.urls };
  if (params.formats?.length) body.formats = params.formats;
  if (typeof params.concurrency === "number") body.concurrency = params.concurrency;

  return await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/batch",
    apiKey,
    timeoutSeconds,
    body,
    label: "WebClaw Batch",
  });
}

// ---------------------------------------------------------------------------
// Brand (v1) — brand identity extraction
// ---------------------------------------------------------------------------
export type WebClawBrandParams = {
  cfg?: OpenClawConfig;
  url: string;
  timeoutSeconds?: number;
};

export async function runWebClawBrand(
  params: WebClawBrandParams,
): Promise<Record<string, unknown>> {
  assertScrapeTargetAllowed(params.url);
  const apiKey = requireApiKey(params.cfg);
  const baseUrl = resolveWebClawBaseUrl(params.cfg);
  const timeoutSeconds = resolveTimeoutSeconds(params.cfg, params.timeoutSeconds);

  return await postJson<Record<string, unknown>>({
    baseUrl,
    path: "/v1/brand",
    apiKey,
    timeoutSeconds,
    body: { url: params.url },
    label: "WebClaw Brand",
  });
}
