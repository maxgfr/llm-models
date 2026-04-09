import { readFallbackCache, writeCache } from "../cache";
import { fetchModelsDevModels } from "../clients/models-dev";
import { fetchOpenRouterModels } from "../clients/openrouter";
import type {
  ModelsDevModel,
  ModelsDevResponse,
  OpenRouterModel,
  OpenRouterResponse,
  UnifiedModel,
} from "../types";

export function openRouterPriceToPerMillion(perToken: string): number {
  return Number.parseFloat(perToken) * 1_000_000;
}

export function normalizeOpenRouterModel(model: OpenRouterModel): UnifiedModel {
  const slashIndex = model.id.indexOf("/");
  const provider = slashIndex > -1 ? model.id.slice(0, slashIndex) : model.id;

  const promptCost = openRouterPriceToPerMillion(model.pricing.prompt);
  const completionCost = openRouterPriceToPerMillion(model.pricing.completion);
  const hasCost = promptCost > 0 || completionCost > 0;

  return {
    id: model.id,
    name: model.name,
    provider,
    context_length: model.context_length,
    output_limit: model.top_provider.max_completion_tokens ?? undefined,
    cost: hasCost
      ? {
          input: promptCost,
          output: completionCost,
          cache_read: model.pricing.input_cache_read
            ? openRouterPriceToPerMillion(model.pricing.input_cache_read)
            : undefined,
          cache_write: model.pricing.input_cache_write
            ? openRouterPriceToPerMillion(model.pricing.input_cache_write)
            : undefined,
          reasoning: model.pricing.internal_reasoning
            ? openRouterPriceToPerMillion(model.pricing.internal_reasoning)
            : undefined,
        }
      : undefined,
    modalities: {
      input: model.architecture.input_modalities,
      output: model.architecture.output_modalities,
    },
    capabilities: {
      tool_call: model.supported_parameters.includes("tools") ? true : undefined,
      structured_output: model.supported_parameters.includes("response_format") ? true : undefined,
      reasoning:
        model.pricing.internal_reasoning && Number.parseFloat(model.pricing.internal_reasoning) > 0
          ? true
          : undefined,
    },
    knowledge_cutoff: model.knowledge_cutoff ?? null,
    release_date: undefined,
    status: undefined,
    family: undefined,
    description: model.description,
    supported_parameters: model.supported_parameters,
    tokenizer: model.architecture.tokenizer,
    hugging_face_id: model.hugging_face_id ?? undefined,
    sources: { openrouter: true, models_dev: false },
  };
}

export function normalizeModelsDevModel(model: ModelsDevModel, providerId: string): UnifiedModel {
  return {
    id: `${providerId}/${model.id}`,
    name: model.name,
    provider: providerId,
    context_length: model.limit.context,
    output_limit: model.limit.output,
    cost: model.cost
      ? {
          input: model.cost.input,
          output: model.cost.output,
          cache_read: model.cost.cache_read,
          cache_write: model.cost.cache_write,
          reasoning: model.cost.reasoning,
          input_audio: model.cost.input_audio,
          output_audio: model.cost.output_audio,
        }
      : undefined,
    modalities: {
      input: model.modalities.input,
      output: model.modalities.output,
    },
    capabilities: {
      reasoning: model.reasoning,
      tool_call: model.tool_call,
      structured_output: model.structured_output,
      open_weights: model.open_weights,
      attachment: model.attachment,
    },
    knowledge_cutoff: model.knowledge ?? null,
    release_date: model.release_date,
    status: model.status,
    family: model.family,
    sources: { openrouter: false, models_dev: true },
  };
}

function mergeModels(openrouter: UnifiedModel, modelsDev: UnifiedModel): UnifiedModel {
  // Merge costs: prefer models.dev base costs but carry OpenRouter extras
  let cost = modelsDev.cost ?? openrouter.cost;
  if (cost && openrouter.cost && modelsDev.cost) {
    cost = {
      ...modelsDev.cost,
      reasoning: modelsDev.cost.reasoning ?? openrouter.cost.reasoning,
      cache_read: modelsDev.cost.cache_read ?? openrouter.cost.cache_read,
      cache_write: modelsDev.cost.cache_write ?? openrouter.cost.cache_write,
    };
  }

  return {
    ...openrouter,
    capabilities: {
      ...openrouter.capabilities,
      ...modelsDev.capabilities,
    },
    release_date: modelsDev.release_date ?? openrouter.release_date,
    status: modelsDev.status ?? openrouter.status,
    family: modelsDev.family ?? openrouter.family,
    knowledge_cutoff: modelsDev.knowledge_cutoff ?? openrouter.knowledge_cutoff,
    cost,
    output_limit: modelsDev.output_limit ?? openrouter.output_limit,
    sources: { openrouter: true, models_dev: true },
  };
}

export async function fetchUnifiedData(): Promise<{
  models: UnifiedModel[];
  modelsDevData: ModelsDevResponse;
}> {
  const results = await Promise.allSettled([fetchOpenRouterModels(), fetchModelsDevModels()]);

  let openRouterData: OpenRouterResponse | null =
    results[0].status === "fulfilled" ? results[0].value : null;
  let modelsDevData: ModelsDevResponse | null =
    results[1].status === "fulfilled" ? results[1].value : null;

  // Fallback to expired cache if an API failed
  if (!openRouterData) {
    openRouterData = readFallbackCache<OpenRouterResponse>("openrouter");
    if (openRouterData) {
      console.error("Warning: OpenRouter API unavailable, using expired cache");
    }
  }
  if (!modelsDevData) {
    modelsDevData = readFallbackCache<ModelsDevResponse>("models-dev");
    if (modelsDevData) {
      console.error("Warning: models.dev API unavailable, using expired cache");
    }
  }

  if (!openRouterData && !modelsDevData) {
    throw new Error("Both APIs are unavailable and no cached data exists");
  }

  // Index models.dev models by "provider/modelId"
  const modelsDevMap = new Map<string, UnifiedModel>();
  if (modelsDevData) {
    for (const [providerId, provider] of Object.entries(modelsDevData)) {
      for (const model of Object.values(provider.models)) {
        const unified = normalizeModelsDevModel(model, providerId);
        modelsDevMap.set(unified.id, unified);
      }
    }
  }

  // Normalize OpenRouter models and merge with models.dev when matched
  const result = new Map<string, UnifiedModel>();

  if (openRouterData) {
    for (const orModel of openRouterData.data) {
      const normalized = normalizeOpenRouterModel(orModel);
      const modelsDevMatch = modelsDevMap.get(normalized.id);

      if (modelsDevMatch) {
        result.set(normalized.id, mergeModels(normalized, modelsDevMatch));
        modelsDevMap.delete(normalized.id);
      } else {
        result.set(normalized.id, normalized);
      }
    }
  }

  // Add remaining models.dev models not found in OpenRouter
  for (const [id, model] of modelsDevMap) {
    result.set(id, model);
  }

  const unified = Array.from(result.values());
  writeCache("unified", unified);
  return { models: unified, modelsDevData: modelsDevData ?? ({} as ModelsDevResponse) };
}

export async function fetchUnifiedModels(): Promise<UnifiedModel[]> {
  return (await fetchUnifiedData()).models;
}
