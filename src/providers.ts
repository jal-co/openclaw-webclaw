import type { WebFetchProviderPlugin } from "openclaw/plugin-sdk/provider-web-fetch";
import { enablePluginInConfig } from "openclaw/plugin-sdk/provider-web-fetch";
import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "openclaw/plugin-sdk/provider-web-search-contract";
import { runWebClawScrape } from "./webclaw-client.js";

const WEBCLAW_CREDENTIAL_PATH = "plugins.entries.webclaw.config.apiKey";

// ---------------------------------------------------------------------------
// Web Fetch Provider — backs OpenClaw's built-in web_fetch tool
// ---------------------------------------------------------------------------
export function createWebClawWebFetchProvider(): WebFetchProviderPlugin {
  return {
    id: "webclaw",
    label: "WebClaw",
    hint: "Fast HTTP extraction with browser-grade TLS impersonation",
    onboardingScopes: ["text-inference"],
    credentialLabel: "WebClaw API key",
    envVars: ["WEBCLAW_API_KEY"],
    placeholder: "wc_...",
    signupUrl: "https://webclaw.io/",
    docsUrl: "https://webclaw.io/docs",
    autoDetectOrder: 50,
    credentialPath: WEBCLAW_CREDENTIAL_PATH,
    applySelectionConfig: (config) => enablePluginInConfig(config, "webclaw").config,
    createTool: ({ config }) => ({
      description: "Fetch a page using WebClaw.",
      parameters: {},
      execute: async (args) => {
        const url = typeof args.url === "string" ? args.url : "";
        const extractMode = args.extractMode === "text" ? "text" : "markdown";
        const maxChars =
          typeof args.maxChars === "number" && Number.isFinite(args.maxChars)
            ? Math.floor(args.maxChars)
            : undefined;
        return await runWebClawScrape({
          cfg: config,
          url,
          extractMode,
          maxChars,
        });
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Web Search Provider — backs OpenClaw's built-in web_search tool
// ---------------------------------------------------------------------------
type WebClawSearchModule = typeof import("./webclaw-client.js");
let webclawClientPromise: Promise<WebClawSearchModule> | undefined;
function loadClient(): Promise<WebClawSearchModule> {
  webclawClientPromise ??= import("./webclaw-client.js");
  return webclawClientPromise;
}

const GenericSearchSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query string." },
    count: {
      type: "number",
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: 10,
    },
  },
  additionalProperties: false,
} satisfies Record<string, unknown>;

export function createWebClawWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "webclaw",
    label: "WebClaw Search",
    hint: "Web search with optional parallel scraping of results",
    onboardingScopes: ["text-inference"],
    credentialLabel: "WebClaw API key",
    envVars: ["WEBCLAW_API_KEY"],
    placeholder: "wc_...",
    signupUrl: "https://webclaw.io/",
    docsUrl: "https://webclaw.io/docs",
    autoDetectOrder: 50,
    credentialPath: WEBCLAW_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: WEBCLAW_CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "webclaw" },
      configuredCredential: { pluginId: "webclaw" },
      selectionPluginId: "webclaw",
    }),
    createTool: (ctx) => ({
      description:
        "Search the web using WebClaw. Returns structured results with snippets. Use webclaw_search for advanced options.",
      parameters: GenericSearchSchema,
      execute: async (args) => {
        const { runWebClawSearch } = await loadClient();
        return await runWebClawSearch({
          cfg: ctx.config,
          query: typeof args.query === "string" ? args.query : "",
          count: typeof args.count === "number" ? args.count : undefined,
        });
      },
    }),
  };
}
