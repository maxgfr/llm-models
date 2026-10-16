/** What an app saves to call a model: a catalog provider, or a custom OpenAI-compatible endpoint. */
export interface LlmSettings {
  apiKey: string;
  /** Model id of the catalog provider. */
  model: string;
  providerId?: string;
  providerName?: string;
  /** AI SDK package of the provider, e.g. "@ai-sdk/anthropic"; OpenAI's when missing. */
  providerNpm?: string;
  /** Base URL of the provider's API. */
  providerApi?: string;
  /** OpenAI-compatible base URL (Ollama, LM Studio, vLLM…); when set, wins over the provider. */
  customEndpoint?: string;
  /** Model name on the custom endpoint. */
  customModel?: string;
  headers?: Record<string, string>;
}

/** Whether settings can call a model: an API key, or a custom endpoint (local servers need no key). */
export function isConfigured(settings: Partial<LlmSettings> | null | undefined): boolean {
  return !!(settings?.apiKey?.trim() || settings?.customEndpoint?.trim());
}

/** The form a settings dialog edits. The two key slots survive toggling the custom endpoint. */
export interface LlmDraft {
  /** Custom endpoint instead of a catalog provider. */
  custom: boolean;
  providerId: string;
  model: string;
  /** Key of the catalog provider. */
  apiKey: string;
  /** Key of the custom endpoint (often none). */
  customApiKey: string;
  customEndpoint: string;
  customModel: string;
  /** Keep the key on this device rather than for the session only. */
  rememberKey: boolean;
}

/** The key of the active slot. */
export function activeKey(draft: LlmDraft): string {
  return draft.custom ? draft.customApiKey : draft.apiKey;
}

/** Whether the draft holds enough to be saved. */
export function canSave(draft: LlmDraft): boolean {
  return draft.custom
    ? !!draft.customEndpoint.trim() && !!draft.customModel.trim()
    : !!draft.apiKey.trim() && !!draft.model;
}

/** Whether a connection test makes sense: an endpoint, or a provider key. */
export function canTest(draft: LlmDraft): boolean {
  return draft.custom ? !!draft.customEndpoint.trim() : !!draft.apiKey.trim();
}

/** The endpoint as an http(s) URL without trailing slash, or null when it is not one. */
export function validateEndpoint(url: string): string | null {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return trimmed.replace(/\/+$/, "");
}

export interface EndpointPreset {
  id: string;
  name: string;
  endpoint: string;
  /** Filled in when the model field is empty. */
  model?: string;
}

/** Local OpenAI-compatible servers, at their default port. */
export const ENDPOINT_PRESETS = {
  ollama: {
    id: "ollama",
    name: "Ollama",
    endpoint: "http://localhost:11434/v1",
    model: "llama3.2",
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    endpoint: "http://localhost:1234/v1",
    model: "local-model",
  },
} as const satisfies Record<string, EndpointPreset>;
