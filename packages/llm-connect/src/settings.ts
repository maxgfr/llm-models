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
  /** Code of the language answers are written in, e.g. "fr" (see `RESPONSE_LANGUAGES`). */
  language?: string;
}

/**
 * Whether settings can call a model: a custom endpoint with a model name (local
 * servers need no key), or a provider key.
 */
export function isConfigured(settings: Partial<LlmSettings> | null | undefined): boolean {
  if (settings?.customEndpoint?.trim()) return !!settings.customModel?.trim();
  return !!settings?.apiKey?.trim();
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
  /** Code of the language answers are written in. */
  language: string;
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

/** Why an endpoint is refused: not an http(s) URL, or plain http to another machine. */
export type EndpointProblem = "invalid-endpoint" | "insecure-endpoint";

/** Whether a host name is this machine: localhost, 127.0.0.0/8 or [::1]. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * What is wrong with an endpoint, or null when it can be called: https, or
 * http on this machine only, so that a key never crosses the network in clear.
 */
export function endpointProblem(url: string): EndpointProblem | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "invalid-endpoint";
  }
  if (parsed.protocol === "https:") return null;
  if (parsed.protocol !== "http:") return "invalid-endpoint";
  return isLoopbackHost(parsed.hostname) ? null : "insecure-endpoint";
}

/**
 * The endpoint without trailing slash, or null when it is not an https URL or
 * an http URL on this machine (see {@link endpointProblem}).
 */
export function validateEndpoint(url: string): string | null {
  if (endpointProblem(url)) return null;
  return url.trim().replace(/\/+$/, "");
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
