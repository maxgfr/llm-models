import { CALLABLE_NPM, type SlimCatalog, type SlimProvider } from "llm-models/catalog";
import type { LlmSettings } from "./settings.js";

/** Providers a settings form lists first: the four whose SDK is native. */
export const DEFAULT_RECOMMENDED: readonly string[] = ["openai", "anthropic", "google", "mistral"];

/** Where a store gets its catalog: the URL of a static one, or a loader such as {@link liveCatalog}. */
export type CatalogSource = string | (() => Promise<SlimCatalog>);

const requests = new Map<string, Promise<SlimCatalog>>();

/**
 * Download the catalog `llm-models catalog` wrote. Every caller shares one
 * request per URL; a failed one is forgotten, so the next call retries.
 */
export function loadCatalog(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SlimCatalog> {
  let request = requests.get(url);
  if (!request) {
    request = fetchImpl(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Model list unavailable (${res.status})`);
        return res.json() as Promise<SlimCatalog>;
      })
      .catch((error: unknown) => {
        requests.delete(url);
        throw error;
      });
    requests.set(url, request);
  }
  return request;
}

export interface LiveCatalogOptions {
  /** URL of a catalog `llm-models catalog` wrote, used when the live build fails. */
  fallbackUrl?: string;
  /** AI SDK packages to keep. Default: those llm-connect calls ({@link CALLABLE_NPM}). */
  npm?: readonly string[];
  /** Provider ids the live catalog must list; the fallback is used otherwise. */
  required?: readonly string[];
  /** fetch for the fallback. */
  fetch?: typeof fetch;
  /** Builds the catalog; default `buildSlimCatalog` from `llm-models/browser`, imported on first call. */
  build?: (options: {
    npm: readonly string[];
    required?: readonly string[];
  }) => Promise<SlimCatalog>;
}

async function buildFromLlmModels(options: {
  npm: readonly string[];
  required?: readonly string[];
}): Promise<SlimCatalog> {
  // Imported on demand: Zod and the API clients only load when settings open
  const { buildSlimCatalog } = await import("llm-models/browser");
  return buildSlimCatalog(options);
}

/**
 * A catalog loader that builds the catalog in the browser from models.dev and
 * OpenRouter (through `llm-models`, imported on first call), so an app ships no
 * daily `models.json` commit. When that fails (offline, an API down, a
 * required provider missing), it downloads `fallbackUrl` instead. Callers share
 * one request; a failed one is forgotten, so the next call retries.
 */
export function liveCatalog(options: LiveCatalogOptions = {}): () => Promise<SlimCatalog> {
  const { fallbackUrl, npm = CALLABLE_NPM, required, build = buildFromLlmModels } = options;
  let request: Promise<SlimCatalog> | null = null;

  async function load(): Promise<SlimCatalog> {
    try {
      const catalog = await build({ npm, ...(required ? { required } : {}) });
      if (Object.keys(catalog).length === 0) throw new Error("Empty catalog");
      return catalog;
    } catch (error) {
      if (!fallbackUrl) throw error;
      return loadCatalog(fallbackUrl, options.fetch);
    }
  }

  return () => {
    if (!request)
      request = load().catch((error: unknown) => {
        request = null;
        throw error;
      });
    return request;
  };
}

/** Forget downloaded catalogs (tests). */
export function clearCatalogCache(): void {
  requests.clear();
}

/** The recommended providers first, in the given order, then the others by name. */
export function splitProviders(
  catalog: SlimCatalog | null | undefined,
  recommendedIds: readonly string[],
): { recommended: SlimProvider[]; others: SlimProvider[] } {
  if (!catalog) return { recommended: [], others: [] };
  const recommended = recommendedIds
    .map((id) => catalog[id])
    .filter((provider): provider is SlimProvider => !!provider);
  const others = Object.values(catalog)
    .filter((provider) => !recommendedIds.includes(provider.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { recommended, others };
}

export type ProviderMeta = Required<
  Pick<LlmSettings, "providerId" | "providerName" | "providerNpm" | "providerApi">
>;

/** OpenAI, the provider used when none is known. */
export const DEFAULT_PROVIDER_META: ProviderMeta = {
  providerId: "openai",
  providerName: "OpenAI",
  providerNpm: "@ai-sdk/openai",
  providerApi: "https://api.openai.com/v1",
};

/** The settings fields describing a catalog provider, or null when the catalog does not list it. */
export function providerMeta(
  catalog: SlimCatalog | null | undefined,
  id: string,
): ProviderMeta | null {
  const provider = catalog?.[id];
  if (!provider) return null;
  return {
    providerId: provider.id,
    providerName: provider.name,
    providerNpm: provider.npm,
    providerApi: provider.api ?? "",
  };
}
