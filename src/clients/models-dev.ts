import { ModelsDevResponseSchema } from "../schemas/models-dev";
import type { ModelsDevResponse } from "../types";

const MODELS_DEV_URL = "https://models.dev/api.json";

export async function fetchModelsDevModels(): Promise<ModelsDevResponse> {
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) {
    throw new Error(`models.dev API error: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return ModelsDevResponseSchema.parse(json);
}
