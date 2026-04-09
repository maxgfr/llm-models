import type { ModelComparison, UnifiedModel } from "../types";
import { fetchUnifiedModels } from "./normalize";

function findModelById(models: UnifiedModel[], query: string): UnifiedModel | undefined {
  // Exact match first
  const exact = models.find((m) => m.id === query);
  if (exact) return exact;

  // Partial match: search in id and name
  const lower = query.toLowerCase();
  const matches = models.filter(
    (m) => m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower),
  );

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const ids = matches.slice(0, 10).map((m) => m.id);
    throw new Error(
      `Ambiguous model "${query}". Did you mean one of:\n${ids.map((id) => `  - ${id}`).join("\n")}`,
    );
  }

  throw new Error(`Model "${query}" not found`);
}

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
  const models = modelIds.map((id) => findModelById(allModels, id) as UnifiedModel);

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
