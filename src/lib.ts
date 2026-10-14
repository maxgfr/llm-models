// The library API, shared by the Node entry (`index.ts`) and the browser entry
// (`browser.ts`). Nothing reachable from here may import a Node.js builtin or
// touch the file system at load: browser-bundle.test.ts enforces it.

export { clearCache, setCacheEnabled } from "./cache-core";
export { fetchModelsDevModels } from "./clients/models-dev";
export { fetchOpenRouterModels } from "./clients/openrouter";
export { getProfile, listProfiles, loadConfig } from "./config-core";
export type {
  BrowserProbeOptions,
  BrowserProbeTarget,
  ProbeManyOptions,
} from "./functions/browser";
export {
  BROWSER_REQUIRED_HEADERS,
  cheapestModels,
  compareModels,
  DEFAULT_BASE_URLS,
  DEFAULT_PROBE_ORIGIN,
  diffModels,
  estimateCost,
  fetchUnifiedData,
  fetchUnifiedModels,
  filterModels,
  findModel,
  findModels,
  formatFields,
  getProvider,
  getStats,
  latestModels,
  listProviders,
  listUseCases,
  mergeModels,
  parseFieldList,
  pickBestModel,
  pickTiers,
  probeBrowserSupport,
  probeBrowserSupportAll,
  providerBaseUrl,
  providersForEndpoint,
  QueryBuilder,
  query,
  readField,
  recommendModels,
  resolveModel,
  sortModels,
} from "./functions/index";
export type { ProviderOptions } from "./functions/provider";
export {
  BrowserSupportSchema,
  CapabilitiesSchema,
  CostEstimateSchema,
  LlmModelsConfigSchema,
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
  BrowserSupport,
  Capabilities,
  CostEstimate,
  LlmModelsConfig,
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
