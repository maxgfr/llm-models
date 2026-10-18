import type { ToolSet } from "ai";
import type { WebSearchVariant } from "./capabilities.js";

/** The name the provider's own web search is declared under. */
export const WEB_SEARCH_TOOL = "web_search";

export interface WebSearchOptions {
  /** Searches per answer on Anthropic, so one turn cannot run up the search bill unseen. Default 5. */
  maxUses?: number;
}

/**
 * The provider's own web search tool for a model's variant (`capabilities.webSearch`), keyed
 * `web_search`, to spread into a call's `tools` after the function tools; `{}` when the model has
 * none. Imports only that provider's SDK. On Anthropic the results come back encrypted in the
 * response messages, which replay them unchanged on the next turn.
 */
export async function webSearchTools(
  variant: WebSearchVariant | null | undefined,
  options: WebSearchOptions = {},
): Promise<ToolSet> {
  const maxUses = options.maxUses ?? 5;
  switch (variant) {
    case "anthropic:web_search_20260209": {
      const { anthropic } = await import("@ai-sdk/anthropic");
      return { [WEB_SEARCH_TOOL]: anthropic.tools.webSearch_20260209({ maxUses }) };
    }
    case "anthropic:web_search_20250305": {
      const { anthropic } = await import("@ai-sdk/anthropic");
      return { [WEB_SEARCH_TOOL]: anthropic.tools.webSearch_20250305({ maxUses }) };
    }
    case "openai:web_search": {
      const { openai } = await import("@ai-sdk/openai");
      return { [WEB_SEARCH_TOOL]: openai.tools.webSearch({}) };
    }
    case "google:google_search": {
      const { google } = await import("@ai-sdk/google");
      return { [WEB_SEARCH_TOOL]: google.tools.googleSearch({}) };
    }
    default:
      return {};
  }
}
