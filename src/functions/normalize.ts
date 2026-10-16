import { readFallbackCache } from "../cache-core";
import { fetchModelsDevModels } from "../clients/models-dev";
import { fetchOpenRouterModels } from "../clients/openrouter";
import type {
  ModelsDevModel,
  ModelsDevResponse,
  OpenRouterModel,
  OpenRouterResponse,
  UnifiedModel,
} from "../types";

/**
 * Drop binary floating-point noise from a price: "0.00000005" * 1e6 is
 * 0.049999999999999996, and models.dev publishes values like
 * 0.024999999999999998. 12 significant digits stay far finer than any price.
 */
function cleanPrice<T extends number | undefined>(price: T): T {
  return (price === undefined ? price : Number(price.toPrecision(12))) as T;
}

export function openRouterPriceToPerMillion(perToken: string): number {
  return cleanPrice(Number.parseFloat(perToken) * 1_000_000);
}

/** OpenRouter's `created` (unix seconds) as a YYYY-MM-DD date in UTC. */
function createdToDate(created: number): string | undefined {
  if (!Number.isFinite(created) || created <= 0) return undefined;
  return new Date(created * 1000).toISOString().slice(0, 10);
}

export function normalizeOpenRouterModel(model: OpenRouterModel): UnifiedModel {
  const slashIndex = model.id.indexOf("/");
  const provider = slashIndex > -1 ? model.id.slice(0, slashIndex) : model.id;

  const promptCost = openRouterPriceToPerMillion(model.pricing.prompt);
  const completionCost = openRouterPriceToPerMillion(model.pricing.completion);
  const hasCost = promptCost > 0 || completionCost > 0;

  return {
    id: model.id,
    openrouter_id: model.id,
    // OpenRouter serves every model it lists, but only its own ("openrouter/auto") are OpenRouter's to call as a
    // provider; the others belong to their vendor's list, whose API may not know this id.
    api_id: provider === "openrouter" ? model.id : undefined,
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
      // The "reasoning" parameter is the signal: most reasoning models bill their
      // thinking as output, so only a few carry an internal_reasoning price.
      reasoning:
        model.supported_parameters.includes("reasoning") ||
        (model.pricing.internal_reasoning &&
          Number.parseFloat(model.pricing.internal_reasoning) > 0)
          ? true
          : undefined,
    },
    knowledge_cutoff: model.knowledge_cutoff ?? null,
    // When OpenRouter listed it: the closest thing to a release date it publishes.
    release_date: createdToDate(model.created),
    // A scheduled removal date means the route is on its way out.
    status: model.expiration_date ? "deprecated" : undefined,
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
    // models.dev keys each model by the id its provider's API accepts.
    api_id: model.id,
    name: model.name,
    provider: providerId,
    context_length: model.limit.context,
    output_limit: model.limit.output,
    cost: model.cost
      ? {
          input: cleanPrice(model.cost.input),
          output: cleanPrice(model.cost.output),
          cache_read: cleanPrice(model.cost.cache_read),
          cache_write: cleanPrice(model.cost.cache_write),
          reasoning: cleanPrice(model.cost.reasoning),
          input_audio: cleanPrice(model.cost.input_audio),
          output_audio: cleanPrice(model.cost.output_audio),
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

export function mergeModels(openrouter: UnifiedModel, modelsDev: UnifiedModel): UnifiedModel {
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

  // Context and output must come from the SAME source. The two APIs describe
  // different endpoints -- OpenRouter routes deepseek-chat at 163,840 context
  // while DeepSeek's own API serves 1,000,000 -- so mixing them produced
  // impossible pairs like context 163,840 with output 384,000. models.dev wins
  // here for the same reason it wins for cost/family/status below: it is the
  // provider-documented source.
  const context_length = modelsDev.context_length ?? openrouter.context_length;
  const output_limit =
    modelsDev.context_length != null
      ? (modelsDev.output_limit ?? openrouter.output_limit)
      : (openrouter.output_limit ?? modelsDev.output_limit);

  return {
    ...openrouter,
    // models.dev's id names the model the way the provider's own API does
    // ("anthropic/claude-opus-4-5", not OpenRouter's "claude-opus-4.5"; the
    // bare id is api_id); OpenRouter's stays reachable as openrouter_id.
    id: modelsDev.id,
    provider: modelsDev.provider,
    openrouter_id: openrouter.openrouter_id ?? openrouter.id,
    api_id: modelsDev.api_id,
    capabilities: {
      ...openrouter.capabilities,
      ...modelsDev.capabilities,
    },
    release_date: modelsDev.release_date ?? openrouter.release_date,
    status: modelsDev.status ?? openrouter.status,
    family: modelsDev.family ?? openrouter.family,
    knowledge_cutoff: modelsDev.knowledge_cutoff ?? openrouter.knowledge_cutoff,
    cost,
    context_length,
    // An output limit above the context window is never meaningful.
    output_limit: output_limit != null ? Math.min(output_limit, context_length) : undefined,
    sources: { openrouter: true, models_dev: true },
  };
}

/**
 * Ids that name the same model in both APIs once case and "." vs "-" are
 * ignored: OpenRouter's "anthropic/claude-opus-4.5" is models.dev's
 * "anthropic/claude-opus-4-5", "minimax/minimax-m2.7" is "minimax/MiniMax-M2.7".
 */
export function looseModelKey(id: string): string {
  return id.toLowerCase().replace(/\./g, "-");
}

/**
 * Pair the OpenRouter models no exact id matched with the models.dev models
 * left over, on `looseModelKey`. Only strict 1:1 pairs count: when either side
 * has two candidates for a key, nothing is merged rather than guessing.
 * Returns OpenRouter id -> models.dev model.
 */
function pairLooseIds(
  openRouter: UnifiedModel[],
  modelsDev: UnifiedModel[],
): Map<string, UnifiedModel> {
  const group = (models: UnifiedModel[]) => {
    const byKey = new Map<string, UnifiedModel[]>();
    for (const model of models) {
      const key = looseModelKey(model.id);
      byKey.set(key, [...(byKey.get(key) ?? []), model]);
    }
    return byKey;
  };
  const openRouterByKey = group(openRouter);
  const modelsDevByKey = group(modelsDev);

  const pairs = new Map<string, UnifiedModel>();
  for (const [key, candidates] of openRouterByKey) {
    const matches = modelsDevByKey.get(key);
    if (candidates.length === 1 && matches?.length === 1) pairs.set(candidates[0].id, matches[0]);
  }
  return pairs;
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

  const reason = (result: PromiseSettledResult<unknown>) =>
    result.status === "rejected"
      ? result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
      : "";

  // Fallback to expired cache if an API failed
  if (!openRouterData) {
    openRouterData = readFallbackCache<OpenRouterResponse>("openrouter");
    if (openRouterData) {
      console.error(
        `Warning: OpenRouter API unavailable (${reason(results[0])}), using expired cache`,
      );
    }
  }
  if (!modelsDevData) {
    modelsDevData = readFallbackCache<ModelsDevResponse>("models-dev");
    if (modelsDevData) {
      console.error(
        `Warning: models.dev API unavailable (${reason(results[1])}), using expired cache`,
      );
    }
  }

  if (!openRouterData && !modelsDevData) {
    throw new Error(
      `Both APIs are unavailable and no cached data exists (OpenRouter: ${reason(results[0])}; models.dev: ${reason(results[1])})`,
    );
  }

  // One source down with nothing cached: carry on, but never silently.
  if (!openRouterData) {
    console.error(
      `Warning: OpenRouter API unavailable (${reason(results[0])}), showing models.dev data only`,
    );
  }
  if (!modelsDevData) {
    console.error(
      `Warning: models.dev API unavailable (${reason(results[1])}), showing OpenRouter data only`,
    );
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
    const openRouterModels = openRouterData.data.map(normalizeOpenRouterModel);
    const openRouterIds = new Set(openRouterModels.map((m) => m.id));
    // Exact ids pair first; only what is left on both sides is tried loosely.
    const looseMatches = pairLooseIds(
      openRouterModels.filter((m) => !modelsDevMap.has(m.id)),
      [...modelsDevMap.values()].filter((m) => !openRouterIds.has(m.id)),
    );

    for (const normalized of openRouterModels) {
      const modelsDevMatch = modelsDevMap.get(normalized.id) ?? looseMatches.get(normalized.id);

      if (modelsDevMatch) {
        const merged = mergeModels(normalized, modelsDevMatch);
        result.set(merged.id, merged);
        modelsDevMap.delete(modelsDevMatch.id);
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
  return { models: unified, modelsDevData: modelsDevData ?? ({} as ModelsDevResponse) };
}

export async function fetchUnifiedModels(): Promise<UnifiedModel[]> {
  return (await fetchUnifiedData()).models;
}
