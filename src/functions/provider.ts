import { fetchModelsDevModels } from "../clients/models-dev";
import type { ProviderInfo, UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";

export async function getProvider(providerId: string): Promise<ProviderInfo> {
  const [allModels, modelsDevData] = await Promise.all([
    fetchUnifiedModels(),
    fetchModelsDevModels(),
  ]);

  const providerModels = allModels.filter(
    (m) => m.provider.toLowerCase() === providerId.toLowerCase(),
  );

  if (providerModels.length === 0) {
    throw new Error(`Provider "${providerId}" not found`);
  }

  const devProvider = modelsDevData[providerId];

  return {
    id: providerId,
    name: devProvider?.name ?? providerId,
    model_count: providerModels.length,
    doc: devProvider?.doc,
    env: devProvider?.env,
    npm: devProvider?.npm,
    api: devProvider?.api,
    models: providerModels,
  };
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const [allModels, modelsDevData] = await Promise.all([
    fetchUnifiedModels(),
    fetchModelsDevModels(),
  ]);

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

  return providers.sort((a, b) => b.model_count - a.model_count);
}
