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
export {
  fetchFalImageModels,
  fetchGatewayImageModels,
  fetchGoogleImageModels,
  fetchOpenAIImageModels,
  fetchOpenRouterImageModels,
  fetchReplicateImageModels,
} from "./clients/image";
export { fetchModelsDevModels } from "./clients/models-dev";
export { fetchOpenRouterModels } from "./clients/openrouter";
export {
  fetchElevenLabsModels,
  fetchElevenLabsVoices,
  fetchFalSpeechModels,
  fetchGatewaySpeechModels,
} from "./clients/speech";
export {
  fetchFalVideoModels,
  fetchGatewayVideoModels,
  fetchGoogleVideoModels,
  fetchOpenRouterVideoModels,
  fetchReplicateVideoModels,
} from "./clients/video";
export { getProfile, listProfiles, loadConfig } from "./config-core";
export type {
  BrowserProbeOptions,
  BrowserProbeTarget,
  ProbeManyOptions,
} from "./functions/browser";
export type { BuildSlimCatalogOptions, SlimCatalogOptions } from "./functions/catalog";
export type { ListImageModelsOptions } from "./functions/image";
export {
  BROWSER_REQUIRED_HEADERS,
  browserModelCatalog,
  buildSlimCatalog,
  cheapestModels,
  compareModels,
  DEFAULT_BASE_URLS,
  DEFAULT_PROBE_ORIGIN,
  describeBrowserModel,
  describeFalImageModel,
  describeFalSpeechModel,
  describeFalVideoModel,
  describeOpenApiImageInput,
  describeOpenApiSpeechInput,
  describeOpenApiVideoInput,
  diffModels,
  enrichImageModel,
  enrichVideoModel,
  estimateCost,
  fetchUnifiedData,
  fetchUnifiedModels,
  filterModels,
  findModel,
  findModels,
  formatFields,
  gatewayImagePrices,
  getProvider,
  getStats,
  latestModels,
  listBrowserModels,
  listImageModels,
  listProviders,
  listSpeechModels,
  listUseCases,
  listVideoModels,
  mergeModels,
  openRouterPrices,
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
  videoMatchKey,
} from "./functions/index";
export type { ProviderOptions } from "./functions/provider";
export type { ListSpeechModelsOptions } from "./functions/speech";
export type { ListVideoModelsOptions } from "./functions/video";
export type { ImageModel, ImageOperation, ImagePrice, ImageProviderId } from "./image";
export {
  filterImageModels,
  IMAGE_OPERATIONS,
  IMAGE_PROVIDERS,
  imagePrice,
  rendersImageFromText,
} from "./image";
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
export type { SpeechModel, SpeechPrice, SpeechProviderId, SpeechVoice } from "./speech";
export {
  filterSpeechModels,
  GEMINI_VOICES,
  OPENAI_VOICES,
  SPEECH_PROVIDERS,
  speechPrice,
} from "./speech";
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
export type {
  VideoModel,
  VideoOperation,
  VideoPrice,
  VideoProviderId,
} from "./video";
export {
  filterVideoModels,
  rendersFromText,
  shortSide,
  VIDEO_OPERATIONS,
  VIDEO_PROVIDERS,
  videoPricePerSecond,
  videoSize,
} from "./video";
