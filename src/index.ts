#!/usr/bin/env node

export { clearCache, setCacheEnabled } from "./cache";
export { fetchModelsDevModels } from "./clients/models-dev";
export { fetchOpenRouterModels } from "./clients/openrouter";
export { getProfile, listProfiles, loadConfig } from "./config";
export {
  cheapestModels,
  compareModels,
  diffModels,
  estimateCost,
  fetchUnifiedModels,
  filterModels,
  findModels,
  getProvider,
  getStats,
  listProviders,
  listUseCases,
  QueryBuilder,
  query,
  recommendModels,
  sortModels,
} from "./functions/index";
export {
  CapabilitiesSchema,
  CostEstimateSchema,
  ModelComparisonSchema,
  ModelFilterSchema,
  ModelSortFieldSchema,
  NormalizedCostSchema,
  ProviderInfoSchema,
  UnifiedModelSchema,
} from "./schemas/functions";
export {
  ModelsDevCostSchema,
  ModelsDevLimitSchema,
  ModelsDevModalitiesSchema,
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevResponseSchema,
} from "./schemas/models-dev";
export {
  OpenRouterArchitectureSchema,
  OpenRouterDefaultParametersSchema,
  OpenRouterLinksSchema,
  OpenRouterModelSchema,
  OpenRouterPricingSchema,
  OpenRouterResponseSchema,
  OpenRouterTopProviderSchema,
} from "./schemas/openrouter";
export type {
  Capabilities,
  CostEstimate,
  ModelComparison,
  ModelFilter,
  ModelSortField,
  ModelsDevModel,
  ModelsDevProvider,
  ModelsDevResponse,
  NormalizedCost,
  OpenRouterModel,
  OpenRouterResponse,
  ProviderInfo,
  UnifiedModel,
} from "./types";

import { runCommand } from "./cli";

const isCLI = typeof Bun !== "undefined" ? Bun.main === import.meta.path : true;

if (isCLI) {
  runCommand();
}
