import { getCacheTtl, readCache, writeCache } from "../cache-core";
import type { BrowserSupport, ProviderInfo, UnifiedModel } from "../types";
import { DEFAULT_PROBE_ORIGIN, type ProbeManyOptions, probeBrowserSupportAll } from "./browser";
import { fetchUnifiedData } from "./normalize";

export interface ProviderOptions {
  /**
   * Also probe whether a web page can call each provider directly (CORS) and
   * attach the verdict as `browser`. `true` probes from https://example.com;
   * pass options to set the origin, a fetch implementation or the concurrency.
   * Verdicts are cached like API responses, unless a custom fetch is given.
   */
  browser?: boolean | ProbeManyOptions;
}

function browserCacheKey(origin: string): string {
  return `browser-${origin.replace(/[^a-z0-9]+/gi, "_")}`;
}

async function withBrowserSupport(
  providers: ProviderInfo[],
  browser: true | ProbeManyOptions,
): Promise<ProviderInfo[]> {
  const options = browser === true ? {} : browser;
  const key = browserCacheKey(options.origin ?? DEFAULT_PROBE_ORIGIN);
  const cacheable = options.fetch === undefined;

  // The file is one map for every provider, so each verdict also ages on its own.
  const now = Date.now();
  const fresh: Record<string, BrowserSupport> = {};
  for (const [id, support] of Object.entries(
    (cacheable ? readCache<Record<string, BrowserSupport>>(key) : null) ?? {},
  )) {
    if (now - Date.parse(support.checked_at) <= getCacheTtl()) fresh[id] = support;
  }

  const missing = providers.filter((p) => !fresh[p.id]);
  const probed = missing.length > 0 ? await probeBrowserSupportAll(missing, options) : {};
  const all = { ...fresh, ...probed };
  if (cacheable && missing.length > 0) writeCache(key, all);

  return providers.map((p) => ({ ...p, browser: all[p.id] }));
}

export async function getProvider(
  providerId: string,
  options: ProviderOptions = {},
): Promise<ProviderInfo> {
  const { models: allModels, modelsDevData } = await fetchUnifiedData();

  const providerModels = allModels.filter(
    (m) => m.provider.toLowerCase() === providerId.toLowerCase(),
  );

  if (providerModels.length === 0) {
    throw new Error(`Provider "${providerId}" not found`);
  }

  // The lookup above ignores case; models.dev keys do not, so use the canonical id.
  const id = providerModels[0].provider;
  const devProvider = modelsDevData[id];

  const provider: ProviderInfo = {
    id,
    name: devProvider?.name ?? id,
    model_count: providerModels.length,
    doc: devProvider?.doc,
    env: devProvider?.env,
    npm: devProvider?.npm,
    api: devProvider?.api,
    models: providerModels,
  };
  if (!options.browser) return provider;
  return (await withBrowserSupport([provider], options.browser))[0];
}

export async function listProviders(options: ProviderOptions = {}): Promise<ProviderInfo[]> {
  const { models: allModels, modelsDevData } = await fetchUnifiedData();

  const providerMap = new Map<string, UnifiedModel[]>();
  for (const model of allModels) {
    const existing = providerMap.get(model.provider) ?? [];
    existing.push(model);
    providerMap.set(model.provider, existing);
  }

  const providers: ProviderInfo[] = [];
  for (const [id, models] of providerMap) {
    const devProvider = modelsDevData[id];
    providers.push({
      id,
      name: devProvider?.name ?? id,
      model_count: models.length,
      doc: devProvider?.doc,
      env: devProvider?.env,
      npm: devProvider?.npm,
      api: devProvider?.api,
      models,
    });
  }

  providers.sort((a, b) => b.model_count - a.model_count);
  if (!options.browser) return providers;
  return withBrowserSupport(providers, options.browser);
}
