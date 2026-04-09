import { z } from "zod";

export const ModelsDevCostOverContextSchema = z
  .object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
  })
  .optional();

export const ModelsDevCostSchema = z
  .object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
    reasoning: z.number().optional(),
    input_audio: z.number().optional(),
    output_audio: z.number().optional(),
    context_over_200k: ModelsDevCostOverContextSchema,
  })
  .optional();

export const ModelsDevLimitSchema = z.object({
  context: z.number(),
  output: z.number(),
  input: z.number().optional(),
});

export const ModelsDevModalitiesSchema = z.object({
  input: z.array(z.string()),
  output: z.array(z.string()),
});

export const ModelsDevModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  tool_call: z.boolean(),
  open_weights: z.boolean(),
  release_date: z.string(),
  last_updated: z.string(),
  modalities: ModelsDevModalitiesSchema,
  limit: ModelsDevLimitSchema,
  family: z.string().optional(),
  knowledge: z.string().optional(),
  temperature: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  cost: ModelsDevCostSchema,
  status: z.string().optional(),
  interleaved: z.union([z.boolean(), z.object({ field: z.string() })]).optional(),
  provider: z
    .object({
      npm: z.string().optional(),
      api: z.string().optional(),
      shape: z.string().optional(),
      body: z.record(z.unknown()).optional(),
    })
    .optional(),
  experimental: z.unknown().optional(),
});

export const ModelsDevProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  doc: z.string(),
  env: z.array(z.string()),
  npm: z.string(),
  api: z.string().optional(),
  models: z.record(z.string(), ModelsDevModelSchema),
});

export const ModelsDevResponseSchema = z.record(z.string(), ModelsDevProviderSchema);
