import { OPENAI_DEFAULT_BASE_URL, resolveAlias } from "./registry.js";
import type { LlmSettings } from "./settings.js";

/**
 * The protocol a model is called with, which decides what a request may carry: Anthropic Messages,
 * OpenAI Responses (the official URL only), Gemini, Mistral, or OpenAI Chat Completions
 * (`openai-compatible`: a custom endpoint, the generic SDK, or the OpenAI SDK on another URL).
 * Another name is a provider the app registered itself, about which nothing is assumed.
 */
export type ProviderKind = "anthropic" | "openai" | "google" | "mistral" | "openai-compatible";

/** Base URLs of the providers that have one; `openai-compatible` always names its own. */
export const DEFAULT_BASE_URLS: Readonly<Partial<Record<ProviderKind, string>>> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: OPENAI_DEFAULT_BASE_URL,
  google: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
};

const ANTHROPIC_HOST = "api.anthropic.com";

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * The protocol the settings call: `openai-compatible` for a custom endpoint and for the OpenAI SDK
 * off the official URL (both go through Chat Completions), else the provider's short name.
 */
export function providerKindOf(settings: LlmSettings): ProviderKind | (string & {}) {
  if (settings.customEndpoint) return "openai-compatible";
  const name = resolveAlias(settings.providerNpm || "openai");
  if (
    name === "openai" &&
    settings.providerApi &&
    trimBase(settings.providerApi) !== OPENAI_DEFAULT_BASE_URL
  )
    return "openai-compatible";
  return name;
}

/** The model id the settings call: the custom endpoint's model, or the catalog model. */
export function modelIdOf(settings: LlmSettings): string {
  if (settings.customEndpoint) return settings.customModel || settings.model || "";
  return settings.model || "";
}

/** The base URL the settings call, without a trailing slash, or undefined when there is none. */
export function baseUrlOf(settings: LlmSettings): string | undefined {
  const url =
    settings.customEndpoint ||
    settings.providerApi ||
    DEFAULT_BASE_URLS[providerKindOf(settings) as ProviderKind];
  return url ? trimBase(url) : undefined;
}

/** Whether a URL is on Anthropic's own API host, the only one that takes its direct-browser opt-in. */
export function isAnthropicHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === ANTHROPIC_HOST;
  } catch {
    return false;
  }
}

/**
 * An Anthropic-compatible base URL as the AI SDK calls it, ending in a version (`/v1`): Anthropic's
 * own convention, which gateways document for their clients, gives the URL without it
 * (`https://api.z.ai/api/anthropic`) and lets the client add `/v1/messages`. Both forms work.
 */
export function anthropicBaseUrl(url: string): string {
  const base = trimBase(url);
  try {
    const { pathname } = new URL(base);
    return /\/v\d+$/.test(pathname) ? base : `${base}/v1`;
  } catch {
    return base;
  }
}
