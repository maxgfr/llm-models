import type { ModelComparison, UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";
import { findModel } from "./resolve";

function findBest(
  values: Record<string, number | null>,
  prefer: "lowest" | "highest",
): string | null {
  let bestId: string | null = null;
  let bestVal: number | null = null;

  for (const [id, val] of Object.entries(values)) {
    if (val === null) continue;
    if (bestVal === null) {
      bestId = id;
      bestVal = val;
      continue;
    }
    if (prefer === "lowest" && val < bestVal) {
      bestId = id;
      bestVal = val;
    }
    if (prefer === "highest" && val > bestVal) {
      bestId = id;
      bestVal = val;
    }
  }

  return bestId;
}

export async function compareModels(modelIds: string[]): Promise<ModelComparison> {
  if (modelIds.length < 2) {
    throw new Error("At least 2 models are required for comparison");
  }

  const allModels = await fetchUnifiedModels();
  // Two spellings of the same model ("gpt-4o", "openai/gpt-4o") collapse to one column.
  const models: UnifiedModel[] = [];
  for (const id of modelIds) {
    const model = findModel(allModels, id);
    if (!models.some((m) => m.id === model.id)) models.push(model);
  }
  if (models.length < 2) {
    throw new Error("At least 2 distinct models are required for comparison");
  }

  const contextValues: Record<string, number | null> = {};
  const outputLimitValues: Record<string, number | null> = {};
  const costInputValues: Record<string, number | null> = {};
  const costOutputValues: Record<string, number | null> = {};
  const capabilities: Record<string, Record<string, boolean | undefined>> = {};
  const modalities: Record<string, { input: string[]; output: string[] }> = {};

  for (const model of models) {
    contextValues[model.id] = model.context_length;
    outputLimitValues[model.id] = model.output_limit ?? null;
    costInputValues[model.id] = model.cost?.input ?? null;
    costOutputValues[model.id] = model.cost?.output ?? null;
    capabilities[model.id] = { ...model.capabilities };
    modalities[model.id] = { ...model.modalities };
  }

  return {
    models,
    dimensions: {
      context_length: {
        values: contextValues,
        best: findBest(contextValues, "highest"),
      },
      output_limit: {
        values: outputLimitValues,
        best: findBest(outputLimitValues, "highest"),
      },
      cost_input: {
        values: costInputValues,
        best: findBest(costInputValues, "lowest"),
      },
      cost_output: {
        values: costOutputValues,
        best: findBest(costOutputValues, "lowest"),
      },
      capabilities,
      modalities,
    },
  };
}
