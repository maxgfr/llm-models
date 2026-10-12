import { z } from "zod";
import { readCache, writeCache } from "../cache";
import { debug } from "../log";
import { ModelsDevModelSchema, ModelsDevProviderSchema } from "../schemas/models-dev";
import type { ModelsDevModel, ModelsDevResponse } from "../types";
import { fetchJson } from "./http";

const MODELS_DEV_URL = "https://models.dev/api.json";

const LooseResponseSchema = z.record(z.string(), z.unknown());

/** A provider's own fields, strictly; its models are checked one by one. */
const LooseProviderSchema = ModelsDevProviderSchema.extend({
  models: z.record(z.string(), z.unknown()),
});

/**
 * Validate a raw api.json document model by model, dropping what no longer
 * matches the schema, so one malformed model never takes its whole provider
 * down. Throws when the document is not an object or no model survives.
 */
export function parseModelsDevResponse(json: unknown): ModelsDevResponse {
  const raw = LooseResponseSchema.parse(json);
  const result: ModelsDevResponse = {};
  let skipped = 0;
  let kept = 0;

  for (const [providerId, entry] of Object.entries(raw)) {
    const provider = LooseProviderSchema.safeParse(entry);
    if (!provider.success) {
      skipped++;
      continue;
    }
    const models: Record<string, ModelsDevModel> = {};
    for (const [modelId, model] of Object.entries(provider.data.models)) {
      const parsed = ModelsDevModelSchema.safeParse(model);
      if (parsed.success) models[modelId] = parsed.data;
      else skipped++;
    }
    kept += Object.keys(models).length;
    result[providerId] = { ...provider.data, models };
  }

  if (skipped > 0) debug(`models.dev: skipped ${skipped} invalid provider or model entries`);
  if (kept === 0) throw new Error("models.dev API returned no valid models");
  return result;
}

export async function fetchModelsDevModels(): Promise<ModelsDevResponse> {
  const cached = readCache<ModelsDevResponse>("models-dev");
  if (cached) return cached;

  const result = parseModelsDevResponse(await fetchJson(MODELS_DEV_URL, "models.dev"));
  writeCache("models-dev", result);
  return result;
}
