// The library API, shared by the Node entry (`index.ts`) and the browser entry
// (`browser.ts`). Nothing reachable from here may import a Node.js builtin or
// touch the file system at load: browser-bundle.test.ts enforces it.

export { clearCache, setCacheEnabled } from "./cache-core";
export type { InputModality, SlimCatalog, SlimModel, SlimProvider, WithInputs } from "./catalog";
export {
  acceptsInput,
  CALLABLE_NPM,
  defaultModelOf,
  filterCatalogModels,
  INPUT_MODALITIES,
  inputsOf,
  normalizeModality,
} from "./catalog";
export type { FetchOptions } from "./clients/http";
export { fetchModelsDevModels } from "./clients/models-dev";
export { fetchOpenRouterModels } from "./clients/openrouter";
export { getProfile, listProfiles, loadConfig } from "./config-core";
export type {
  BrowserProbeOptions,
  BrowserProbeTarget,
  ProbeManyOptions,
} from "./functions/browser";
export type { BuildSlimCatalogOptions, SlimCatalogOptions } from "./functions/catalog";
export {
  BROWSER_REQUIRED_HEADERS,
  browserModelCatalog,
  buildSlimCatalog,
  cheapestModels,
  compareModels,
  DEFAULT_BASE_URLS,
  DEFAULT_PROBE_ORIGIN,
  describeBrowserModel,
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
  listBrowserModels,
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
  recommendBrowserModel,
  recommendModels,
  resolveModel,
  slimCatalog,
  sortModels,
} from "./functions/index";
export type { ProviderOptions } from "./functions/provider";
export {
  BrowserModelCatalogSchema,
  BrowserModelNeedSchema,
  BrowserModelQualitySchema,
  BrowserModelRecommendationOptionsSchema,
  BrowserModelRecommendationSchema,
  BrowserModelRecordSchema,
  BrowserModelSchema,
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
  BrowserModel,
  BrowserModelCatalog,
  BrowserModelNeed,
  BrowserModelQuality,
  BrowserModelRecommendation,
  BrowserModelRecommendationOptions,
  BrowserModelRecord,
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
