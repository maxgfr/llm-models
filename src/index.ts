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
  fetchUnifiedData,
  fetchUnifiedModels,
  filterModels,
  findModels,
  formatFields,
  getProvider,
  getStats,
  listProviders,
  listUseCases,
  mergeModels,
  parseFieldList,
  pickBestModel,
  providersForEndpoint,
  QueryBuilder,
  query,
  readField,
  recommendModels,
  resolveModel,
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

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCommand } from "./cli";

/**
 * True only when this file is the process entry point. Under Node the check
 * goes through realpath so the npm bin symlink still counts, and importing the
 * package as a library never starts the CLI.
 */
function isEntryPoint(): boolean {
  if (typeof Bun !== "undefined") return Bun.main === import.meta.path;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  runCommand();
}
