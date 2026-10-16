import { createAnthropic } from "@ai-sdk/anthropic";
import { type ProviderFactory, registerProvider } from "../registry.js";

/** Anthropic and Anthropic-compatible APIs (MiniMax, Z.ai…), called from the browser. */
export const factory: ProviderFactory = (config) =>
  createAnthropic({
    apiKey: config.apiKey,
    // Anthropic-compatible providers have their own URL: never send their key to Anthropic
    ...(config.baseURL && { baseURL: config.baseURL }),
    headers: {
      ...config.headers,
      "anthropic-dangerous-direct-browser-access": "true",
    },
  })(config.model);

export function register(): void {
  registerProvider("anthropic", factory);
}
