import { createAnthropic } from "@ai-sdk/anthropic";
import { ANTHROPIC_BROWSER_HEADER } from "../fetch.js";
import { anthropicBaseUrl, DEFAULT_BASE_URLS, isAnthropicHost } from "../provider-kind.js";
import { type ProviderFactory, registerProvider } from "../registry.js";

/** Anthropic and Anthropic-compatible APIs (MiniMax, Z.ai…), called from the browser. */
export const factory: ProviderFactory = (config) =>
  createAnthropic({
    apiKey: config.apiKey,
    // Anthropic-compatible providers have their own URL: never send their key to Anthropic.
    // With or without its /v1, as gateways document it for Anthropic's own clients.
    ...(config.baseURL && { baseURL: anthropicBaseUrl(config.baseURL) }),
    headers: {
      ...config.headers,
      // Anthropic's own opt-in to calls from a web page; another host's preflight may refuse it
      ...(isAnthropicHost(config.baseURL ?? DEFAULT_BASE_URLS.anthropic) && {
        [ANTHROPIC_BROWSER_HEADER]: "true",
      }),
    },
    ...(config.fetch && { fetch: config.fetch as typeof globalThis.fetch }),
  })(config.model);

export function register(): void {
  registerProvider("anthropic", factory);
}
