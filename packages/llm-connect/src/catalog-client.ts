import type { SlimCatalog, SlimProvider } from "llm-models/catalog";
import type { LlmSettings } from "./settings.js";

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
