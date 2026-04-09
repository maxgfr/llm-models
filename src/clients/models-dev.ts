import { readCache, writeCache } from "../cache";
import { ModelsDevResponseSchema } from "../schemas/models-dev";
import type { ModelsDevResponse } from "../types";

const MODELS_DEV_URL = "https://models.dev/api.json";

export async function fetchModelsDevModels(): Promise<ModelsDevResponse> {
  const cached = readCache<ModelsDevResponse>("models-dev");
  if (cached) return cached;

  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) {
    throw new Error(`models.dev API error: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  const result = ModelsDevResponseSchema.parse(json);
  writeCache("models-dev", result);
  return result;
}
