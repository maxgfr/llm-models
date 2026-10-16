import type { LanguageModel } from "ai";

/** Configuration passed to a provider factory when creating a model. */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  headers?: Record<string, string>;
}

/** A function that creates a LanguageModel from configuration. */
export type ProviderFactory = (config: ProviderConfig) => LanguageModel;

const registry = new Map<string, ProviderFactory>();

/** npm package names → the short names providers are registered under. */
const ALIASES: Record<string, string> = {
  "@ai-sdk/openai": "openai",
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "google",
  "@ai-sdk/mistral": "mistral",
  "@ai-sdk/openai-compatible": "openai-compatible",
};

/** The short name a provider or npm package name is registered under. */
export function resolveAlias(name: string): string {
  return ALIASES[name] ?? name;
}

/**
 * Register a provider factory under a name: a short one (`"openai"`) or an
 * npm package name (`"@ai-sdk/openai"`), both mapping to the same slot.
 *
 * @example
 * ```ts
 * import { registerProvider, fromSDK } from "llm-connect";
 * import { createOpenAI } from "@ai-sdk/openai";
 *
 * registerProvider("openai", fromSDK(createOpenAI));
 * registerProvider("my-llm", (config) => myCustomSDK.createModel(config.apiKey, config.model));
 * ```
 */
export function registerProvider(name: string, factory: ProviderFactory): void {
  registry.set(resolveAlias(name), factory);
}

/** Register several providers at once. */
export function registerProviders(providers: Record<string, ProviderFactory>): void {
  for (const [name, factory] of Object.entries(providers)) {
    registerProvider(name, factory);
  }
}

/** Default base URL of `@ai-sdk/openai`. */
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

function isOfficialOpenAIURL(url: string): boolean {
  return url.trim().replace(/\/+$/, "") === OPENAI_DEFAULT_BASE_URL;
}

/**
 * Wrap an AI SDK provider creator, `createXxx(options) → provider(model)`,
 * into a {@link ProviderFactory}.
 */
export function fromSDK(
  // Intentionally loose: every @ai-sdk/* creator has its own option type, but
  // they all follow (options) => (model) => LanguageModel.
  // biome-ignore lint/suspicious/noExplicitAny: see above
  creator: (options: any) => any,
): ProviderFactory {
  return (config: ProviderConfig): LanguageModel => {
    const provider = creator({
      apiKey: config.apiKey,
      ...(config.baseURL && { baseURL: config.baseURL }),
      ...(config.headers && { headers: config.headers }),
    });
    // OpenAI-compatible servers generally implement Chat Completions rather than
    // Responses; the official OpenAI URL keeps the SDK default (Responses API).
    if (
      config.baseURL &&
      !isOfficialOpenAIURL(config.baseURL) &&
      typeof provider.chat === "function"
    )
      return provider.chat(config.model) as LanguageModel;
    return provider(config.model) as LanguageModel;
  };
}

/** A provider by name, or `undefined` if not registered. */
export function getProvider(name: string): ProviderFactory | undefined {
  return registry.get(resolveAlias(name));
}

/** Whether a provider is registered. */
export function hasProvider(name: string): boolean {
  return registry.has(resolveAlias(name));
}

/** Remove every registered provider (tests). */
export function clearProviders(): void {
  registry.clear();
}

const NPM_HINT: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  mistral: "mistral",
  "openai-compatible": "openai-compatible",
};

/** A registered provider, or an error that says how to register it. */
export function requireProvider(name: string): ProviderFactory {
  const resolved = resolveAlias(name);
  const factory = registry.get(resolved);
  if (factory) return factory;

  const builtin = NPM_HINT[resolved];
  const example = builtin
    ? `  import { register } from "llm-connect/providers/${builtin}";\n  register();\n\n` +
      `or let loadModel() import it on demand.`
    : `  import { registerProvider } from "llm-connect";\n` +
      `  registerProvider("${resolved}", (config) => /* your LanguageModel */);`;
  throw new Error(
    `Provider "${resolved}" is not registered.\n\nRegister it before calling AI functions:\n\n${example}\n`,
  );
}
