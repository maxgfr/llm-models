import { z } from "zod";

export const NormalizedCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
  reasoning: z.number().optional(),
  input_audio: z.number().optional(),
  output_audio: z.number().optional(),
});

export const CapabilitiesSchema = z.object({
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  open_weights: z.boolean().optional(),
  attachment: z.boolean().optional(),
});

export const UnifiedModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  context_length: z.number(),
  output_limit: z.number().optional(),
  cost: NormalizedCostSchema.optional(),
  modalities: z.object({
    input: z.array(z.string()),
    output: z.array(z.string()),
  }),
  capabilities: CapabilitiesSchema,
  knowledge_cutoff: z.string().nullable().optional(),
  release_date: z.string().optional(),
  status: z.string().optional(),
  family: z.string().optional(),
  description: z.string().optional(),
  supported_parameters: z.array(z.string()).optional(),
  tokenizer: z.string().optional(),
  hugging_face_id: z.string().nullable().optional(),
  sources: z.object({
    openrouter: z.boolean(),
    models_dev: z.boolean(),
  }),
});

export const ProviderInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  model_count: z.number(),
  doc: z.string().optional(),
  env: z.array(z.string()).optional(),
  npm: z.string().optional(),
  api: z.string().optional(),
  models: z.array(UnifiedModelSchema),
});

export const CapabilityEnum = z.enum([
  "reasoning",
  "tool_call",
  "structured_output",
  "open_weights",
  "attachment",
]);

export const ModelFilterSchema = z.object({
  provider: z.string().optional(),
  capability: CapabilityEnum.optional(),
  modality: z.string().optional(),
  maxCostInput: z.number().optional(),
  maxCostOutput: z.number().optional(),
  minContext: z.number().optional(),
  search: z.string().optional(),
  status: z.enum(["active", "deprecated", "beta"]).optional(),
  family: z.string().optional(),
});

export const ModelSortFieldSchema = z.enum([
  "cost_input",
  "cost_output",
  "context_length",
  "release_date",
  "name",
  "knowledge_cutoff",
  "value",
]);

export const CostEstimateSchema = z.object({
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  input_cost_usd: z.number(),
  output_cost_usd: z.number(),
  total_cost_usd: z.number(),
});

export const ModelComparisonDimensionSchema = z.object({
  values: z.record(z.string(), z.number().nullable()),
  best: z.string().nullable(),
});

export const ModelComparisonSchema = z.object({
  models: z.array(UnifiedModelSchema),
  dimensions: z.object({
    context_length: ModelComparisonDimensionSchema,
    output_limit: ModelComparisonDimensionSchema,
    cost_input: ModelComparisonDimensionSchema,
    cost_output: ModelComparisonDimensionSchema,
    capabilities: z.record(z.string(), z.record(z.string(), z.boolean().optional())),
    modalities: z.record(
      z.string(),
      z.object({ input: z.array(z.string()), output: z.array(z.string()) }),
    ),
  }),
});
