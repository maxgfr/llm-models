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

// --- Models that run inside the browser (WebGPU, WebLLM) ---

/**
 * One prebuilt WebLLM model as `scripts/build-browser-models.ts` extracts it
 * from @mlc-ai/web-llm's `prebuiltAppConfig` and the model's Hugging Face repo.
 * Every field is copied, none is typed by hand; `null` means "not published".
 */
export const BrowserModelRecordSchema = z.object({
  /** WebLLM's `model_id`, what `CreateMLCEngine` takes. */
  model_id: z.string(),
  /** Hugging Face repo holding the weights. */
  model: z.string(),
  /** URL of the compiled WebGPU library (wasm). */
  model_lib: z.string(),
  model_type: z.enum(["llm", "embedding", "vlm"]),
  vram_required_mb: z.number().positive(),
  /** WebLLM: "whether the model can run on limited devices (e.g. Android phone)". */
  low_resource_required: z.boolean(),
  /** Context WebLLM loads the model with (`overrides.context_window_size`). */
  context_window: z.number().int().positive().nullable(),
  /** Context the model library was compiled for (`mlc-chat-config.json`). */
  config_context_window: z.number().int().positive().nullable(),
  /** WebGPU features the device must expose (e.g. `shader-f16`). */
  required_features: z.array(z.string()),
  buffer_size_required_bytes: z.number().nullable(),
  /** Listed in WebLLM's `functionCallingModelIds` (`tools` in requests). */
  function_calling: z.boolean(),
  /** Sum of the weight shards in the repo's tensor-cache.json: the download. */
  weights_bytes: z.number().nonnegative().nullable(),
  /** `ParamBytes` / `BitsPerParam` from tensor-cache.json metadata. */
  param_bytes: z.number().nonnegative().nullable(),
  bits_per_param: z.number().positive().nullable(),
});

/** `src/data/browser-models.json`: the extracted catalog and where it came from. */
export const BrowserModelCatalogSchema = z.object({
  source: z.object({
    package: z.string(),
    version: z.string(),
    /** WebLLM's `modelVersion`: the prebuilt libraries this npm version loads. */
    model_version: z.string(),
    tarball: z.string(),
    generated_at: z.string(),
  }),
  models: z.array(BrowserModelRecordSchema),
});

export const BrowserModelNeedSchema = z.enum(["json", "multilingual", "reasoning", "long_context"]);

/** A published, cited benchmark score backing a ranking. */
export const BrowserModelQualitySchema = z.object({
  metric: z.string(),
  value: z.number(),
  source: z.string(),
});

/** A browser model with what its id, its family and the catalog tell about it. */
export const BrowserModelSchema = z.object({
  id: z.string(),
  /** Vendor line: qwen, llama, gemma, phi, smollm, mistral… */
  family: z.string(),
  /** Generation within the family: "Qwen3.5", "Llama-3.2", "gemma-2"… */
  series: z.string(),
  /** Release month of the series (YYYY-MM), from the vendor's model card. */
  released: z.string().nullable(),
  kind: z.enum(["llm", "embedding", "vlm"]),
  /** chat = instruction/chat tuned; reasoning = always thinks; base = not instruction tuned. */
  variant: z.enum(["chat", "reasoning", "base", "coder", "math", "vision", "embedding"]),
  /** Billions of parameters ("E2B" counts the effective 2B). */
  params_b: z.number().positive().nullable(),
  /** "id" when the size is in the model id, "weights" when estimated from ParamBytes. */
  params_source: z.enum(["id", "weights"]).nullable(),
  /** MLC quantization code: q4f16_1 = 4-bit weights, fp16 compute. */
  quantization: z.string(),
  weight_bits: z.number().int().positive(),
  compute_dtype: z.enum(["f16", "f32"]),
  vram_required_mb: z.number().positive(),
  low_resource_required: z.boolean(),
  context_window: z.number().int().positive().nullable(),
  max_context_window: z.number().int().positive().nullable(),
  /** Weight shards to download, in MB (1e6 bytes); null when the repo publishes no manifest. */
  download_mb: z.number().nonnegative().nullable(),
  hf_repo: z.string(),
  model_lib: z.string(),
  required_features: z.array(z.string()),
  /** JSON mode / JSON-schema output via WebLLM's grammar-constrained decoding. */
  structured_output: z.boolean(),
  function_calling: z.boolean(),
  /** Can think step by step (reasoning-only models, or hybrid thinking per the model card). */
  reasoning: z.boolean(),
  /** The model card claims support for languages beyond English. */
  multilingual: z.boolean(),
  quality: BrowserModelQualitySchema.nullable(),
});

export const BrowserModelRecommendationOptionsSchema = z.object({
  /** GPU memory the page may use, in MB (compared to WebLLM's vram_required_MB). */
  vram_budget_mb: z.number().positive(),
  /** Largest acceptable weight download, in MB. Models of unknown size are then skipped. */
  download_budget_mb: z.number().positive().optional(),
  needs: z.array(BrowserModelNeedSchema).optional(),
  /** Whether the WebGPU adapter exposes `shader-f16`; false keeps only f32-compute models. */
  shader_f16: z.boolean().optional(),
  /** Only models WebLLM marks `low_resource_required` (phones, small GPUs). */
  low_resource: z.boolean().optional(),
  /** How many runner-up models to return (default 3). */
  alternatives: z.number().int().nonnegative().optional(),
});

export const BrowserModelRecommendationSchema = z.object({
  model: BrowserModelSchema,
  reason: z.string(),
  alternatives: z.array(BrowserModelSchema),
});
