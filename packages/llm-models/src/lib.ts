// The library API, shared by the Node entry (`index.ts`) and the browser entry
// (`browser.ts`). Nothing reachable from here may import a Node.js builtin or
// touch the file system at load: browser-bundle.test.ts enforces it.

export { clearCache, setCacheEnabled } from "./cache-core.js";
export type { InputModality, SlimCatalog, SlimModel, SlimProvider, WithInputs } from "./catalog.js";
export {
  acceptsInput,
  CALLABLE_NPM,
  defaultModelOf,
  filterCatalogModels,
  INPUT_MODALITIES,
  inputsOf,
  normalizeModality,
} from "./catalog.js";
export type { FetchOptions } from "./clients/http.js";
export {
  fetchFalImageModels,
  fetchGatewayImageModels,
  fetchGoogleImageModels,
  fetchOpenAIImageModels,
  fetchOpenRouterImageModels,
  fetchReplicateImageModels,
} from "./clients/image.js";
export { fetchModelsDevModels } from "./clients/models-dev.js";
export { fetchOpenRouterModels } from "./clients/openrouter.js";
export {
  fetchElevenLabsModels,
  fetchElevenLabsVoices,
  fetchFalSpeechModels,
  fetchGatewaySpeechModels,
} from "./clients/speech.js";
export {
  fetchFalVideoModels,
  fetchGatewayVideoModels,
  fetchGoogleVideoModels,
  fetchOpenRouterVideoModels,
  fetchReplicateVideoModels,
} from "./clients/video.js";
export { getProfile, listProfiles, loadConfig } from "./config-core.js";
export type {
  BrowserProbeOptions,
  BrowserProbeTarget,
  ProbeManyOptions,
} from "./functions/browser.js";
export type { BuildSlimCatalogOptions, SlimCatalogOptions } from "./functions/catalog.js";
export type { ListImageModelsOptions } from "./functions/image.js";
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
} from "./functions/index.js";
export type { ProviderOptions } from "./functions/provider.js";
export type { ListSpeechModelsOptions } from "./functions/speech.js";
export type { ListVideoModelsOptions } from "./functions/video.js";
export type { ImageModel, ImageOperation, ImagePrice, ImageProviderId } from "./image.js";
export {
  filterImageModels,
  IMAGE_OPERATIONS,
  IMAGE_PROVIDERS,
  imagePrice,
  rendersImageFromText,
} from "./image.js";
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
} from "./schemas/functions.js";
export {
  ModelsDevCostSchema,
  ModelsDevLimitSchema,
  ModelsDevModalitiesSchema,
  ModelsDevModelSchema,
  ModelsDevProviderSchema,
  ModelsDevResponseSchema,
} from "./schemas/models-dev.js";
export {
  OpenRouterArchitectureSchema,
  OpenRouterDefaultParametersSchema,
  OpenRouterLinksSchema,
  OpenRouterModelSchema,
  OpenRouterPricingSchema,
  OpenRouterResponseSchema,
  OpenRouterTopProviderSchema,
} from "./schemas/openrouter.js";
export type { SpeechModel, SpeechPrice, SpeechProviderId, SpeechVoice } from "./speech.js";
export {
  filterSpeechModels,
  GEMINI_VOICES,
  OPENAI_VOICES,
  SPEECH_PROVIDERS,
  speechPrice,
} from "./speech.js";
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
} from "./types.js";
export type {
  VideoModel,
  VideoOperation,
  VideoPrice,
  VideoProviderId,
} from "./video.js";
export {
  filterVideoModels,
  rendersFromText,
  shortSide,
  VIDEO_OPERATIONS,
  VIDEO_PROVIDERS,
  videoPricePerSecond,
  videoSize,
} from "./video.js";
