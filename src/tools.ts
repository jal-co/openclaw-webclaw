import { optionalStringEnum } from "openclaw/plugin-sdk/channel-actions";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import {
  jsonResult,
  readNumberParam,
  readStringParam,
  readStringArrayParam,
} from "openclaw/plugin-sdk/provider-web-search";
import { Type } from "typebox";
import {
  runWebClawScrape,
  runWebClawSearch,
  startWebClawCrawl,
  getWebClawCrawlStatus,
  runWebClawExtract,
  runWebClawSummarize,
  runWebClawDiff,
  runWebClawMap,
  runWebClawBatch,
  runWebClawBrand,
} from "./webclaw-client.js";

// ---------------------------------------------------------------------------
// webclaw_scrape
// ---------------------------------------------------------------------------
const ScrapeSchema = Type.Object(
  {
    url: Type.String({ description: "HTTP or HTTPS URL to scrape." }),
    formats: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Output formats: "markdown", "llm", "text", "json", "links", "rawHtml", "screenshot", "query". Default: ["markdown"].',
      }),
    ),
    extractMode: optionalStringEnum(["markdown", "text"] as const, {
      description: 'Extraction mode for returned text. Default: "markdown".',
    }),
    maxChars: Type.Optional(
      Type.Number({ description: "Maximum characters to return.", minimum: 100 }),
    ),
    onlyMainContent: Type.Optional(
      Type.Boolean({ description: "Extract only main content, skip nav/footer." }),
    ),
    includeSelectors: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to extract exclusively." }),
    ),
    excludeSelectors: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to exclude." }),
    ),
    screenshot: Type.Optional(
      Type.Boolean({ description: "Take a screenshot. Returns base64 PNG." }),
    ),
    mobile: Type.Optional(
      Type.Boolean({ description: "Use mobile User-Agent." }),
    ),
    query: Type.Optional(
      Type.String({ description: 'Natural language question about the page. Use with format "query".' }),
    ),
    timeoutSeconds: Type.Optional(
      Type.Number({ description: "Request timeout in seconds.", minimum: 1 }),
    ),
  },
  { additionalProperties: false },
);

export function createScrapeTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_scrape",
    label: "WebClaw Scrape",
    description:
      "Scrape a page using WebClaw v1 API. Supports CSS filtering, screenshots, browser actions, mobile UA, page Q&A, and 9 output formats. No headless browser — fast HTTP extraction with TLS impersonation.",
    parameters: ScrapeSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawScrape({
          cfg: api.config,
          url: readStringParam(rawParams, "url", { required: true }),
          formats: readStringArrayParam(rawParams, "formats"),
          extractMode:
            readStringParam(rawParams, "extractMode") === "text" ? "text" : "markdown",
          maxChars: readNumberParam(rawParams, "maxChars", { integer: true }),
          onlyMainContent:
            typeof rawParams.onlyMainContent === "boolean" ? rawParams.onlyMainContent : undefined,
          includeSelectors: readStringArrayParam(rawParams, "includeSelectors"),
          excludeSelectors: readStringArrayParam(rawParams, "excludeSelectors"),
          screenshot: rawParams.screenshot === true,
          mobile: rawParams.mobile === true,
          query: readStringParam(rawParams, "query"),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_search
// ---------------------------------------------------------------------------
const SearchSchema = Type.Object(
  {
    query: Type.String({ description: "Search query." }),
    count: Type.Optional(
      Type.Number({ description: "Number of results (1-10). Default: 5.", minimum: 1, maximum: 10 }),
    ),
    scrape: Type.Optional(
      Type.Boolean({ description: "Scrape content from each result URL. Default: true." }),
    ),
    country: Type.Optional(Type.String({ description: 'Country code for localized results (e.g. "us").' })),
    lang: Type.Optional(Type.String({ description: 'Language code (e.g. "en").' })),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createSearchTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_search",
    label: "WebClaw Search",
    description:
      "Web search using WebClaw. Returns structured results with optional parallel scraping of all result URLs.",
    parameters: SearchSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawSearch({
          cfg: api.config,
          query: readStringParam(rawParams, "query", { required: true }),
          count: readNumberParam(rawParams, "count", { integer: true }),
          scrape: typeof rawParams.scrape === "boolean" ? rawParams.scrape : undefined,
          country: readStringParam(rawParams, "country"),
          lang: readStringParam(rawParams, "lang"),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_crawl
// ---------------------------------------------------------------------------
const CrawlSchema = Type.Object(
  {
    url: Type.String({ description: "Starting URL to crawl." }),
    action: optionalStringEnum(["start", "status"] as const, {
      description: '"start" to begin a crawl, "status" to check a running crawl. Default: "start".',
    }),
    crawlId: Type.Optional(Type.String({ description: "Crawl job ID (for status checks)." })),
    maxDepth: Type.Optional(Type.Number({ description: "Maximum crawl depth. Default: 2.", minimum: 1 })),
    maxPages: Type.Optional(Type.Number({ description: "Maximum pages. Default: 50.", minimum: 1 })),
    useSitemap: Type.Optional(Type.Boolean({ description: "Seed from sitemap.xml." })),
    includePaths: Type.Optional(Type.Array(Type.String(), { description: "Glob patterns for paths to include." })),
    excludePaths: Type.Optional(Type.Array(Type.String(), { description: "Glob patterns for paths to exclude." })),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createCrawlTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_crawl",
    label: "WebClaw Crawl",
    description:
      'BFS crawl a website. Use action="start" to begin, then action="status" with the returned crawlId to poll for results.',
    parameters: CrawlSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = readStringParam(rawParams, "action") || "start";
      if (action === "status") {
        const crawlId = readStringParam(rawParams, "crawlId", { required: true });
        return jsonResult(
          await getWebClawCrawlStatus({
            cfg: api.config,
            crawlId,
            timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
          }),
        );
      }
      return jsonResult(
        await startWebClawCrawl({
          cfg: api.config,
          url: readStringParam(rawParams, "url", { required: true }),
          maxDepth: readNumberParam(rawParams, "maxDepth", { integer: true }),
          maxPages: readNumberParam(rawParams, "maxPages", { integer: true }),
          useSitemap: rawParams.useSitemap === true,
          includePaths: readStringArrayParam(rawParams, "includePaths"),
          excludePaths: readStringArrayParam(rawParams, "excludePaths"),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_extract
// ---------------------------------------------------------------------------
const ExtractSchema = Type.Object(
  {
    url: Type.String({ description: "URL to extract structured data from." }),
    schema: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: "JSON schema describing the data to extract.",
      }),
    ),
    prompt: Type.Optional(
      Type.String({ description: "Natural language description of what to extract." }),
    ),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createExtractTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_extract",
    label: "WebClaw Extract",
    description:
      "LLM-powered structured data extraction from a URL. Provide a JSON schema or a natural language prompt.",
    parameters: ExtractSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawExtract({
          cfg: api.config,
          url: readStringParam(rawParams, "url", { required: true }),
          schema: rawParams.schema as Record<string, unknown> | undefined,
          prompt: readStringParam(rawParams, "prompt"),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_summarize
// ---------------------------------------------------------------------------
const SummarizeSchema = Type.Object(
  {
    url: Type.String({ description: "URL to summarize." }),
    sentences: Type.Optional(
      Type.Number({ description: "Number of sentences. Default: 3.", minimum: 1, maximum: 20 }),
    ),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createSummarizeTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_summarize",
    label: "WebClaw Summarize",
    description: "LLM-powered summarization of a web page.",
    parameters: SummarizeSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawSummarize({
          cfg: api.config,
          url: readStringParam(rawParams, "url", { required: true }),
          sentences: readNumberParam(rawParams, "sentences", { integer: true }),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_diff
// ---------------------------------------------------------------------------
const DiffSchema = Type.Object(
  {
    url: Type.String({ description: "URL to compare against snapshot." }),
    snapshot: Type.Record(Type.String(), Type.Unknown(), {
      description: "Previous JSON snapshot from a WebClaw scrape (json format).",
    }),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createDiffTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_diff",
    label: "WebClaw Diff",
    description:
      "Compare current page content against a previous JSON snapshot to detect changes.",
    parameters: DiffSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawDiff({
          cfg: api.config,
          url: readStringParam(rawParams, "url", { required: true }),
          snapshot: rawParams.snapshot as Record<string, unknown>,
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_map
// ---------------------------------------------------------------------------
const MapSchema = Type.Object(
  {
    url: Type.String({ description: "Base URL to discover sitemap URLs from." }),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createMapTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_map",
    label: "WebClaw Map",
    description:
      "Discover all URLs on a site from sitemap.xml and robots.txt. Returns the full URL list.",
    parameters: MapSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawMap({
          cfg: api.config,
          url: readStringParam(rawParams, "url", { required: true }),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_batch
// ---------------------------------------------------------------------------
const BatchSchema = Type.Object(
  {
    urls: Type.Array(Type.String(), {
      description: "Array of URLs to extract.",
      minItems: 1,
      maxItems: 100,
    }),
    formats: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Output formats. Default: ["markdown"].',
      }),
    ),
    concurrency: Type.Optional(
      Type.Number({ description: "Max concurrent requests. Default: 5.", minimum: 1, maximum: 20 }),
    ),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createBatchTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_batch",
    label: "WebClaw Batch",
    description: "Extract content from multiple URLs concurrently in a single request.",
    parameters: BatchSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawBatch({
          cfg: api.config,
          urls: readStringArrayParam(rawParams, "urls") ?? [],
          formats: readStringArrayParam(rawParams, "formats"),
          concurrency: readNumberParam(rawParams, "concurrency", { integer: true }),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// webclaw_brand
// ---------------------------------------------------------------------------
const BrandSchema = Type.Object(
  {
    url: Type.String({ description: "URL to extract brand identity from." }),
    timeoutSeconds: Type.Optional(Type.Number({ description: "Request timeout.", minimum: 1 })),
  },
  { additionalProperties: false },
);

export function createBrandTool(api: OpenClawPluginApi) {
  return {
    name: "webclaw_brand",
    label: "WebClaw Brand",
    description:
      "Extract brand identity from a website: colors, fonts, logo URL, and favicon.",
    parameters: BrandSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      return jsonResult(
        await runWebClawBrand({
          cfg: api.config,
          url: readStringParam(rawParams, "url", { required: true }),
          timeoutSeconds: readNumberParam(rawParams, "timeoutSeconds", { integer: true }),
        }),
      );
    },
  };
}
