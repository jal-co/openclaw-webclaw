import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { createWebClawWebFetchProvider, createWebClawWebSearchProvider } from "./providers.js";
import {
  createScrapeTool,
  createSearchTool,
  createCrawlTool,
  createExtractTool,
  createSummarizeTool,
  createDiffTool,
  createMapTool,
  createBatchTool,
  createBrandTool,
} from "./tools.js";

export default definePluginEntry({
  id: "webclaw",
  name: "WebClaw Plugin",
  description:
    "Web extraction via WebClaw v1 API — scrape, search, crawl, extract, summarize, diff, map, batch, and brand. Replaces Firecrawl.",
  register(api) {
    // Register as the web fetch and web search provider so OpenClaw's
    // built-in web_fetch/web_search tools route through WebClaw.
    api.registerWebFetchProvider(createWebClawWebFetchProvider());
    api.registerWebSearchProvider(createWebClawWebSearchProvider());

    // Register dedicated tools for the full WebClaw v1 API surface.
    api.registerTool(createScrapeTool(api) as AnyAgentTool);
    api.registerTool(createSearchTool(api) as AnyAgentTool);
    api.registerTool(createCrawlTool(api) as AnyAgentTool);
    api.registerTool(createExtractTool(api) as AnyAgentTool);
    api.registerTool(createSummarizeTool(api) as AnyAgentTool);
    api.registerTool(createDiffTool(api) as AnyAgentTool);
    api.registerTool(createMapTool(api) as AnyAgentTool);
    api.registerTool(createBatchTool(api) as AnyAgentTool);
    api.registerTool(createBrandTool(api) as AnyAgentTool);
  },
});
