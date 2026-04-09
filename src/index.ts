#!/usr/bin/env node

export { fetchOpenRouterModels } from "./clients/openrouter";
export { fetchModelsDevModels } from "./clients/models-dev";
export {
  OpenRouterModelSchema,
  OpenRouterResponseSchema,
  OpenRouterArchitectureSchema,
  OpenRouterPricingSchema,
  OpenRouterTopProviderSchema,
  OpenRouterDefaultParametersSchema,
  OpenRouterLinksSchema,
} from "./schemas/openrouter";
export {
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevResponseSchema,
  ModelsDevCostSchema,
  ModelsDevLimitSchema,
  ModelsDevModalitiesSchema,
} from "./schemas/models-dev";
export {
  UnifiedModelSchema,
  ProviderInfoSchema,
  ModelFilterSchema,
  ModelSortFieldSchema,
  NormalizedCostSchema,
  CostEstimateSchema,
  ModelComparisonSchema,
  CapabilitiesSchema,
} from "./schemas/functions";
export {
  fetchUnifiedModels,
  findModels,
  filterModels,
  sortModels,
  compareModels,
  getProvider,
  listProviders,
  estimateCost,
  cheapestModels,
  getStats,
  recommendModels,
  listUseCases,
  diffModels,
  query,
  QueryBuilder,
} from "./functions/index";
export { setCacheEnabled, clearCache } from "./cache";
export { loadConfig, getProfile, listProfiles } from "./config";
export type {
  OpenRouterModel,
  OpenRouterResponse,
  ModelsDevModel,
  ModelsDevProvider,
  ModelsDevResponse,
  UnifiedModel,
  NormalizedCost,
  Capabilities,
  ProviderInfo,
  ModelFilter,
  ModelSortField,
  CostEstimate,
  ModelComparison,
} from "./types";

import { runCommand } from "./cli";

const isCLI = typeof Bun !== "undefined" ? Bun.main === import.meta.path : true;

if (isCLI) {
  runCommand();
}
