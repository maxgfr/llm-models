// llm-connect: connect a web app to an LLM provider through the AI SDK.
// No UI framework here (see llm-connect/react), and no SDK imported eagerly:
// each one loads on demand (loadModel) or through llm-connect/providers/*.

export type { SlimCatalog, SlimModel, SlimProvider } from "llm-models/catalog";
export { CALLABLE_NPM, defaultModelOf, filterCatalogModels } from "llm-models/catalog";
export {
  clearCatalogCache,
  DEFAULT_PROVIDER_META,
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
export { createModel, loadModel, providerNameOf } from "./model.js";
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
export {
  activeKey,
  canSave,
  canTest,
  ENDPOINT_PRESETS,
  type EndpointPreset,
  isConfigured,
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
