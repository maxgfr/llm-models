import type { Capabilities, CostEstimate, UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";
import { findModel } from "./resolve";
import { filterModels, sortModels } from "./search";

export interface CostProjection {
  daily_cost_usd: number;
  monthly_cost_usd: number;
}

/**
 * Daily and monthly spend for a per-request cost. Either volume implies the
 * other (a month is 30 days); when both are given each is used as stated.
 * Returns null when neither volume is given.
 */
export function projectCost(
  totalPerRequest: number,
  volume: { daily?: number; monthly?: number },
): CostProjection | null {
  const { daily, monthly } = volume;
  if (daily == null && monthly == null) return null;
  return {
    daily_cost_usd:
      daily != null ? totalPerRequest * daily : (totalPerRequest * (monthly ?? 0)) / 30,
    monthly_cost_usd:
      monthly != null ? totalPerRequest * monthly : totalPerRequest * (daily ?? 0) * 30,
  };
}

export async function estimateCost(options: {
  modelIds: string[];
  inputTokens: number;
  outputTokens: number;
}): Promise<CostEstimate[]> {
  const allModels = await fetchUnifiedModels();

  return options.modelIds.map((id) => {
    const model = findModel(allModels, id);

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

  // Only priced models, and never a deprecated one: it is on its way out.
  models = models.filter((m) => m.cost != null && m.status !== "deprecated");

  models = filterModels(models, {
    minContext: options?.minContext,
    capability: options?.capability,
  });

  models = sortModels(models, "cost_input");

  // 0 (or less) means all, as for find and recommend.
  const limit = options?.limit ?? 10;
  return limit > 0 ? models.slice(0, limit) : models;
}
