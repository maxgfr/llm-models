import type { Capabilities, CostEstimate, UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";
import { pickBestModel } from "./resolve";
import { filterModels, sortModels } from "./search";

function findModelById(models: UnifiedModel[], query: string): UnifiedModel {
  // Same ranking as `resolve`: exact id, then trailing segment, then substring,
  // with canonical entries beating resellers on ties.
  const model = pickBestModel(models, query);
  if (model) return model;
  throw new Error(`Model "${query}" not found`);
}

export async function estimateCost(options: {
  modelIds: string[];
  inputTokens: number;
  outputTokens: number;
}): Promise<CostEstimate[]> {
  const allModels = await fetchUnifiedModels();

  return options.modelIds.map((id) => {
    const model = findModelById(allModels, id);

    const inputCost = model.cost ? (options.inputTokens / 1_000_000) * model.cost.input : 0;
    const outputCost = model.cost ? (options.outputTokens / 1_000_000) * model.cost.output : 0;

    return {
      model: model.id,
      input_tokens: options.inputTokens,
      output_tokens: options.outputTokens,
      input_cost_usd: inputCost,
      output_cost_usd: outputCost,
      total_cost_usd: inputCost + outputCost,
    };
  });
}

export async function cheapestModels(options?: {
  minContext?: number;
  capability?: keyof Capabilities;
  limit?: number;
}): Promise<UnifiedModel[]> {
  let models = await fetchUnifiedModels();

  // Only include models with pricing
  models = models.filter((m) => m.cost != null);

  models = filterModels(models, {
    minContext: options?.minContext,
    capability: options?.capability,
  });

  models = sortModels(models, "cost_input");

  const limit = options?.limit ?? 10;
  return models.slice(0, limit);
}
