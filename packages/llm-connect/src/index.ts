// llm-connect: connect a web app to an LLM provider through the AI SDK.
// No UI framework here (see llm-connect/react), and no SDK imported eagerly:
// each one loads on demand (loadModel) or through llm-connect/providers/*.
// Speech to text: `transcribe` with the provider's model, or llm-connect/whisper in the page.

export type { SlimCatalog, SlimModel, SlimProvider } from "llm-models/catalog";
export { CALLABLE_NPM, defaultModelOf, filterCatalogModels } from "llm-models/catalog";
export {
  type CallCheck,
  type CallOptions,
  type CallOptionsInput,
  type CallProblem,
  type CallProblemCode,
  callOptions,
  callProblem,
  LlmCallError,
  refusalOf,
  type Sampling,
  type StopReason,
  stopReasonOf,
} from "./call.js";
export {
  type Capabilities,
  type CapabilityOverride,
  type CatalogModelInfo,
  KNOWN_ANTHROPIC_MODELS,
  type ModelCost,
  type ResolveCapabilitiesInput,
  resolveCapabilities,
  SAMPLING_PARAMS,
  type SamplingParam,
  type WebSearchVariant,
} from "./capabilities.js";
export {
  type CatalogSource,
  clearCatalogCache,
  DEFAULT_PROVIDER_META,
  DEFAULT_RECOMMENDED,
  type LiveCatalogOptions,
  liveCatalog,
  loadCatalog,
  type ProviderMeta,
  providerMeta,
  splitProviders,
} from "./catalog-client.js";
export {
  type ConnectionFailureReason,
  type ConnectionResult,
  type ListModelsOptions,
  listEndpointModels,
  type TestConnectionOptions,
  testConnection,
} from "./connection.js";
export {
  EFFORTS,
  type Effort,
  type EffortWire,
  effortLevels,
  effortWire,
  modelKey,
  usableEffort,
} from "./effort.js";
export {
  describeError,
  type LlmError,
  type LlmErrorCode,
  maskedErrorStatus,
  scrubSecret,
} from "./errors.js";
export {
  ANTHROPIC_BROWSER_HEADER,
  type FetchLike,
  type GuardedFetchOptions,
  guardedFetch,
} from "./fetch.js";
export {
  createKeyVault,
  type KeyVault,
  KeyVaultError,
  type KeyVaultErrorCode,
  type KeyVaultKdf,
  type KeyVaultKdfParams,
  type KeyVaultOptions,
  type KeyVaultState,
  PBKDF2_DEFAULT_ITERATIONS,
  PBKDF2_ITERATION_BOUNDS,
  PBKDF2_KDF_ID,
  pbkdf2Kdf,
  type UnlockOptions,
} from "./key-vault.js";
export {
  browserLanguage,
  DEFAULT_LANGUAGE,
  languageName,
  RESPONSE_LANGUAGES,
  type ResponseLanguage,
  toLanguageCode,
} from "./language.js";
export { createModel, loadModel, type ModelOptions, providerNameOf } from "./model.js";
export {
  anthropicBaseUrl,
  baseUrlOf,
  DEFAULT_BASE_URLS,
  isAnthropicHost,
  modelIdOf,
  type ProviderKind,
  providerKindOf,
} from "./provider-kind.js";
export {
  clearProviders,
  fromSDK,
  getProvider,
  hasProvider,
  OPENAI_DEFAULT_BASE_URL,
  type ProviderConfig,
  type ProviderFactory,
  registerProvider,
  registerProviders,
  requireProvider,
  resolveAlias,
} from "./registry.js";
export { type SecureStorageOptions, secureStorage } from "./secure-storage.js";
export {
  activeKey,
  canSave,
  canTest,
  ENDPOINT_PRESETS,
  type EndpointPreset,
  type EndpointProblem,
  endpointProblem,
  isConfigured,
  isLoopbackHost,
  type LlmDraft,
  type LlmSettings,
  validateEndpoint,
} from "./settings.js";
export {
  type SettingsStorage,
  type StoredSettings,
  type WebStorageOptions,
  webStorage,
} from "./storage.js";
export {
  type CatalogStatus,
  createLlmSettingsStore,
  type LlmSettingsState,
  type LlmSettingsStore,
  type LlmStoreOptions,
  type SaveResult,
} from "./store.js";
export {
  joinWords,
  looksLikeWords,
  segmentsFromWords,
  type Transcript,
  type TranscriptInput,
  type TranscriptPiece,
  toTranscript,
  toWebVtt,
  type WordTimings,
  wordsFromSegments,
} from "./transcript.js";
export {
  type AudioInput,
  DEFAULT_TRANSCRIPTION_MODELS,
  loadTranscriptionModel,
  type TranscribeOptions,
  type TranscriptionModelOptions,
  type TranscriptionProblem,
  type TranscriptionProblemCode,
  type TranscriptionSdk,
  type TranscriptionTarget,
  transcribe,
  transcriptionProblem,
  transcriptionTargetOf,
} from "./transcription.js";
export {
  defaultKeyName,
  migrateToVault,
  type VaultStorageOptions,
  vaultStorage,
} from "./vault-storage.js";
export { WEB_SEARCH_TOOL, type WebSearchOptions, webSearchTools } from "./web-search.js";
