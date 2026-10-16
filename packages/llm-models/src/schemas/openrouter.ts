import { z } from "zod";

export const OpenRouterArchitectureSchema = z.object({
  modality: z.string(),
  input_modalities: z.array(z.string()),
  output_modalities: z.array(z.string()),
  tokenizer: z.string(),
  instruct_type: z.string().nullable().optional(),
});

export const OpenRouterPricingSchema = z.object({
  prompt: z.string(),
  completion: z.string(),
  web_search: z.string().nullable().optional(),
  input_cache_read: z.string().nullable().optional(),
  input_cache_write: z.string().nullable().optional(),
  internal_reasoning: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  audio: z.string().nullable().optional(),
});

export const OpenRouterTopProviderSchema = z.object({
  context_length: z.number().nullable().optional(),
  max_completion_tokens: z.number().nullable().optional(),
  is_moderated: z.boolean(),
});

export const OpenRouterDefaultParametersSchema = z
  .object({
    temperature: z.number().nullable().optional(),
    top_p: z.number().nullable().optional(),
    top_k: z.number().nullable().optional(),
    frequency_penalty: z.number().nullable().optional(),
    presence_penalty: z.number().nullable().optional(),
    repetition_penalty: z.number().nullable().optional(),
  })
  .nullable()
  .optional();

export const OpenRouterLinksSchema = z.object({
  details: z.string(),
});

export const OpenRouterModelSchema = z.object({
  id: z.string(),
  canonical_slug: z.string(),
  name: z.string(),
  description: z.string(),
  created: z.number(),
  context_length: z.number(),
  hugging_face_id: z.string().nullable().optional(),
  knowledge_cutoff: z.string().nullable().optional(),
  expiration_date: z.string().nullable().optional(),
  per_request_limits: z.unknown().nullable().optional(),
  supported_parameters: z.array(z.string()),
  architecture: OpenRouterArchitectureSchema,
  pricing: OpenRouterPricingSchema,
  top_provider: OpenRouterTopProviderSchema,
  default_parameters: OpenRouterDefaultParametersSchema,
  links: OpenRouterLinksSchema,
});

export const OpenRouterResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});
