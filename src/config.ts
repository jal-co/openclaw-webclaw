import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveSecretInputString, normalizeSecretInput } from "openclaw/plugin-sdk/secret-input";
import { canResolveEnvSecretRefInReadOnlyPath } from "openclaw/plugin-sdk/extension-shared";

export const DEFAULT_WEBCLAW_BASE_URL = "https://api.webclaw.io";
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const DEFAULT_MAX_AGE_MS = 172_800_000; // 48 hours
const WEBCLAW_API_KEY_ENV_VAR = "WEBCLAW_API_KEY";

type PluginConfig =
  | {
      apiKey?: unknown;
      baseUrl?: string;
      timeoutSeconds?: number;
      onlyMainContent?: boolean;
      maxAgeMs?: number;
    }
  | undefined;

function resolvePluginConfig(cfg?: OpenClawConfig): PluginConfig {
  return cfg?.plugins?.entries?.webclaw?.config as PluginConfig;
}

export function resolveWebClawApiKey(cfg?: OpenClawConfig): string | undefined {
  const pluginConfig = resolvePluginConfig(cfg);

  // Try configured secret first
  if (pluginConfig?.apiKey) {
    const resolved = resolveSecretInputString({
      value: pluginConfig.apiKey,
      path: "plugins.entries.webclaw.config.apiKey",
      defaults: cfg?.secrets?.defaults,
      mode: "inspect",
    });
    if (resolved.status === "available") {
      const normalized = normalizeSecretInput(resolved.value);
      if (normalized) return normalized;
    }
    if (resolved.status === "blocked") {
      // Check if env ref is resolvable
      if (resolved.ref.source === "env" && resolved.ref.id.trim() === WEBCLAW_API_KEY_ENV_VAR) {
        if (
          canResolveEnvSecretRefInReadOnlyPath({
            cfg,
            provider: resolved.ref.provider,
            id: WEBCLAW_API_KEY_ENV_VAR,
          })
        ) {
          const envValue = normalizeSecretInput(process.env[WEBCLAW_API_KEY_ENV_VAR]);
          if (envValue) return envValue;
        }
      }
      return undefined;
    }
  }

  // Fall back to env var
  return normalizeSecretInput(process.env[WEBCLAW_API_KEY_ENV_VAR]) || undefined;
}

export function resolveWebClawBaseUrl(cfg?: OpenClawConfig): string {
  const pluginConfig = resolvePluginConfig(cfg);
  const configured =
    (typeof pluginConfig?.baseUrl === "string" ? pluginConfig.baseUrl.trim() : "") ||
    normalizeSecretInput(process.env.WEBCLAW_BASE_URL) ||
    "";
  return configured || DEFAULT_WEBCLAW_BASE_URL;
}

export function resolveTimeoutSeconds(cfg?: OpenClawConfig, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  const pluginConfig = resolvePluginConfig(cfg);
  if (
    typeof pluginConfig?.timeoutSeconds === "number" &&
    Number.isFinite(pluginConfig.timeoutSeconds) &&
    pluginConfig.timeoutSeconds > 0
  ) {
    return Math.floor(pluginConfig.timeoutSeconds);
  }
  return DEFAULT_TIMEOUT_SECONDS;
}

export function resolveOnlyMainContent(cfg?: OpenClawConfig, override?: boolean): boolean {
  if (typeof override === "boolean") return override;
  const pluginConfig = resolvePluginConfig(cfg);
  if (typeof pluginConfig?.onlyMainContent === "boolean") return pluginConfig.onlyMainContent;
  return true;
}

export function resolveMaxAgeMs(cfg?: OpenClawConfig, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  const pluginConfig = resolvePluginConfig(cfg);
  if (
    typeof pluginConfig?.maxAgeMs === "number" &&
    Number.isFinite(pluginConfig.maxAgeMs) &&
    pluginConfig.maxAgeMs >= 0
  ) {
    return Math.floor(pluginConfig.maxAgeMs);
  }
  return DEFAULT_MAX_AGE_MS;
}
