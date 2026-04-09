import type { ModelFilter, ModelSortField, UnifiedModel } from "../types";
import { findModels } from "./search";

export interface UseCasePreset {
  description: string;
  filter: ModelFilter;
  sort: ModelSortField;
  descending?: boolean;
}

const PRESETS: Record<string, UseCasePreset> = {
  "code-gen": {
    description: "Code generation with structured output support",
    filter: { capability: "structured_output" },
    sort: "cost_input",
  },
  vision: {
    description: "Image understanding and analysis",
    filter: { modality: "image" },
    sort: "cost_input",
  },
  "cheap-chatbot": {
    description: "Cheapest models suitable for conversational AI",
    filter: { minContext: 32000 },
    sort: "cost_input",
  },
  reasoning: {
    description: "Advanced reasoning and complex problem solving",
    filter: { capability: "reasoning" },
    sort: "cost_input",
  },
  "long-context": {
    description: "Models with the largest context windows",
    filter: { minContext: 200000 },
    sort: "context_length",
    descending: true,
  },
  "open-source": {
    description: "Open-weights models you can self-host",
    filter: { capability: "open_weights" },
    sort: "cost_input",
  },
  audio: {
    description: "Audio input processing",
    filter: { modality: "audio" },
    sort: "cost_input",
  },
  "tool-use": {
    description: "Function calling and tool use",
    filter: { capability: "tool_call" },
    sort: "cost_input",
  },
};

export function listUseCases(): Record<string, UseCasePreset> {
  return PRESETS;
}

export async function recommendModels(
  useCase: string,
  options?: { limit?: number; maxCost?: number; minContext?: number },
): Promise<{ preset: UseCasePreset; models: UnifiedModel[] }> {
  const preset = PRESETS[useCase];
  if (!preset) {
    const available = Object.keys(PRESETS).join(", ");
    throw new Error(`Unknown use case "${useCase}". Available: ${available}`);
  }

  const filter: ModelFilter = {
    ...preset.filter,
    ...(options?.maxCost != null ? { maxCostInput: options.maxCost } : {}),
    ...(options?.minContext != null ? { minContext: options.minContext } : {}),
  };

  const models = await findModels({
    filter,
    sort: preset.sort,
    descending: preset.descending,
    limit: options?.limit ?? 10,
  });

  return { preset, models };
}
