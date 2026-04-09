import type { z } from "zod";
import type {
  CapabilitiesSchema,
  CostEstimateSchema,
  ModelComparisonSchema,
  ModelFilterSchema,
  ModelSortFieldSchema,
  NormalizedCostSchema,
  ProviderInfoSchema,
  UnifiedModelSchema,
} from "./schemas/functions";
import type {
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevResponseSchema,
} from "./schemas/models-dev";
import type { OpenRouterModelSchema, OpenRouterResponseSchema } from "./schemas/openrouter";

export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;
export type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>;
export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>;
export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>;
export type ModelsDevResponse = z.infer<typeof ModelsDevResponseSchema>;

export type UnifiedModel = z.infer<typeof UnifiedModelSchema>;
export type NormalizedCost = z.infer<typeof NormalizedCostSchema>;
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;
export type ModelFilter = z.infer<typeof ModelFilterSchema>;
export type ModelSortField = z.infer<typeof ModelSortFieldSchema>;
export type CostEstimate = z.infer<typeof CostEstimateSchema>;
export type ModelComparison = z.infer<typeof ModelComparisonSchema>;
