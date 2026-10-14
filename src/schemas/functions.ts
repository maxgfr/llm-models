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
  /** models.dev's id when the model is listed there (the provider's own API id), else OpenRouter's. */
  id: z.string(),
  /** OpenRouter's id for this model, when OpenRouter lists it (e.g. "anthropic/claude-opus-4.5"). */
  openrouter_id: z.string().optional(),
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

/**
 * Whether a web page on `origin` can call the provider's API directly (CORS),
 * as observed by `probeBrowserSupport`. It says nothing about whether it is wise:
 * the page then holds the user's API key.
 */
export const BrowserSupportSchema = z.object({
  /** The provider's CORS preflight lets `origin` send an authenticated JSON POST. */
  callable: z.boolean(),
  /** Headers the page must also send for the call to be allowed. */
  required_headers: z.record(z.string(), z.string()).optional(),
  /** The page origin the probe announced. */
  origin: z.string(),
  /** The URL probed (the provider's chat endpoint), when a base URL is known. */
  url: z.string().optional(),
  /**
   * What the verdict rests on: the preflight answer, a simple GET tried after
   * the preflight was refused, or nothing (no base URL, network failure).
   */
  evidence: z.enum(["preflight", "get", "none"]),
  /** Why the provider is not callable, or what the GET fallback showed. */
  reason: z.string().optional(),
  /** ISO timestamp of the probe. */
  checked_at: z.string(),
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
  /** Present only when browser support was asked for (`listProviders({ browser: true })`). */
  browser: BrowserSupportSchema.optional(),
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
  status: z.enum(["active", "deprecated", "beta", "alpha"]).optional(),
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

export const OutputFormatSchema = z.enum(["table", "json", "csv", "markdown"]);

/** A token count as typed on the command line: 5000, 10K, 1.5M. */
const TokenCountSchema = z.string().regex(/^\d+(\.\d+)?[KkMm]?$/, "Use a number or suffix K/M");

export const WorkloadProfileSchema = z.object({
  input: TokenCountSchema,
  output: TokenCountSchema,
});

/** `.llm-modelsrc` / `~/.config/llm-models/config.json`. */
export const LlmModelsConfigSchema = z.object({
  cache: z
    .object({
      enabled: z.boolean().optional(),
      /** Freshness window for API responses, milliseconds. */
      ttl: z.number().int().positive().optional(),
    })
    .optional(),
  defaults: z
    .object({
      format: OutputFormatSchema.optional(),
      /** `find` rows in table/markdown output; 0 = all. */
      limit: z.number().int().min(0).optional(),
      /** `find` sort field when --sort is absent. */
      sort: ModelSortFieldSchema.optional(),
      /** `find` sort direction when --desc is absent. */
      desc: z.boolean().optional(),
    })
    .optional(),
  profiles: z.record(z.string(), WorkloadProfileSchema).optional(),
});

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
