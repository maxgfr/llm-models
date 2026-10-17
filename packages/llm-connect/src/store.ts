import {
  defaultModelOf,
  filterCatalogModels,
  type SlimCatalog,
  type SlimModel,
  type SlimProvider,
} from "llm-models/catalog";
import {
  type CatalogSource,
  DEFAULT_PROVIDER_META,
  DEFAULT_RECOMMENDED,
  loadCatalog,
  type ProviderMeta,
  providerMeta,
  splitProviders,
} from "./catalog-client.js";
import { type ConnectionResult, testConnection } from "./connection.js";
import { browserLanguage, toLanguageCode } from "./language.js";
import {
  activeKey,
  canSave,
  canTest,
  type EndpointPreset,
  endpointProblem,
  type LlmDraft,
  type LlmSettings,
  validateEndpoint,
} from "./settings.js";
import type { SettingsStorage, StoredSettings } from "./storage.js";

export type CatalogStatus = "idle" | "loading" | "error" | "ready";

export interface LlmStoreOptions<E extends object = object> {
  /**
   * The catalog: the URL of one `llm-models catalog` wrote ("/models.json"), or
   * a loader such as `liveCatalog({ fallbackUrl: "/models.json" })`.
   */
  catalog?: CatalogSource;
  /** @deprecated Use `catalog`. */
  catalogUrl?: string;
  storage: SettingsStorage<E>;
  /** Provider ids listed first, in this order. Default OpenAI, Anthropic, Google, Mistral. */
  recommended?: readonly string[];
  /**
   * How `test()` checks the settings (see `testConnection`). Default "models":
   * the model list, which costs nothing. "generate" runs a one-line generation
   * (a few tokens of the user's quota); "auto" lists first and generates only
   * when the server has no model list to give.
   */
  testMode?: "auto" | "models" | "generate";
  /** Draft values before anything is saved. The language defaults to the browser's. */
  defaults?: Partial<Pick<LlmDraft, "providerId" | "model" | "rememberKey" | "language">>;
  fetch?: typeof fetch;
}

export interface LlmSettingsState<E extends object = object> {
  catalog: SlimCatalog | null;
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  /** Settings as last loaded or saved. */
  saved: StoredSettings<E> | null;
  /** The form being edited. */
  draft: LlmDraft;
  /** Model search query. */
  search: string;
  testing: boolean;
  testResult: ConnectionResult | null;

  // Derived from the above
  /** Catalog entry of the draft's provider. */
  provider: SlimProvider | null;
  providers: { recommended: SlimProvider[]; others: SlimProvider[] };
  /** Whether the draft's provider is one of the recommended ones. */
  isRecommendedProvider: boolean;
  /** Models of the draft's provider matching the search. */
  models: SlimModel[];
  /** The provider's recommended model, when it matches the search. */
  recommendedModel: SlimModel | null;
  /** The key field: the provider's, or the custom endpoint's. */
  apiKey: string;
  canSave: boolean;
  canTest: boolean;
}

export type SaveResult<E extends object = object> =
  | { ok: true; settings: StoredSettings<E> }
  | { ok: false; reason: "incomplete" | "invalid-endpoint" | "insecure-endpoint" };

export interface LlmSettingsStore<E extends object = object> {
  getState(): LlmSettingsState<E>;
  /** Calls `listener` now and on every change (the Svelte store contract); returns the unsubscribe. */
  subscribe(listener: (state: LlmSettingsState<E>) => void): () => void;
  /** Read the saved settings and fill the draft with them, unless it was edited since `open()`. */
  load(): Promise<StoredSettings<E> | null>;
  /** Take these settings as the saved ones and reset the draft to them (settings held by the app). */
  reset(saved: StoredSettings<E> | null): void;
  /** A dialog opens: drop unsaved edits and download the catalog if needed. */
  open(): void;
  retryCatalog(): void;
  /** Switch provider and pick its recommended model. */
  selectProvider(id: string): void;
  selectModel(id: string): void;
  /** Set the key of the active slot. */
  setApiKey(key: string): void;
  setSearch(query: string): void;
  toggleCustom(on?: boolean): void;
  /** Fill the endpoint, and the model when empty. */
  applyPreset(preset: EndpointPreset): void;
  setEndpoint(url: string): void;
  setCustomModel(model: string): void;
  setRememberKey(remember: boolean): void;
  /** Set the language answers are written in (a code, or a name as older settings stored it). */
  setLanguage(language: string): void;
  /** The settings the draft would save. */
  settings(): LlmSettings;
  test(options?: { signal?: AbortSignal }): Promise<ConnectionResult>;
  /** Validate and store the draft, with the app's own fields. */
  save(extra?: Partial<E>): Promise<SaveResult<E>>;
  /** Forget the saved settings and the draft's key, endpoint and language. */
  clear(): Promise<void>;
}

/**
 * The state and actions of an LLM settings form, without any UI framework:
 * catalog download, provider and model choice, two key slots, local endpoint
 * presets, connection test and storage. `llm-connect/react` binds it to React;
 * Svelte reads it as a store (`$store`).
 */
export function createLlmSettingsStore<E extends object = object>(
  options: LlmStoreOptions<E>,
): LlmSettingsStore<E> {
  const recommendedIds = options.recommended ?? DEFAULT_RECOMMENDED;
  const source = options.catalog ?? options.catalogUrl;
  if (!source) throw new Error("createLlmSettingsStore: `catalog` is required");
  const catalogSource: CatalogSource = source;
  const defaults = {
    providerId: options.defaults?.providerId ?? recommendedIds[0] ?? "openai",
    model: options.defaults?.model ?? "",
    rememberKey: options.defaults?.rememberKey ?? false,
  };
  // Read when needed rather than now: the store can be created during server rendering
  const defaultLanguage = () =>
    options.defaults?.language ? toLanguageCode(options.defaults.language) : browserLanguage();

  function draftFrom(saved: StoredSettings<E> | null): LlmDraft {
    const custom = !!saved?.customEndpoint;
    const key = saved?.apiKey ?? "";
    return {
      custom,
      providerId: saved?.providerId || defaults.providerId,
      model: saved?.model || defaults.model,
      apiKey: custom ? "" : key,
      customApiKey: custom ? key : "",
      customEndpoint: saved?.customEndpoint ?? "",
      customModel: saved?.customModel ?? "",
      rememberKey: saved?.rememberKey ?? defaults.rememberKey,
      language: saved?.language ? toLanguageCode(saved.language) : defaultLanguage(),
    };
  }

  type Core = Pick<
    LlmSettingsState<E>,
    | "catalog"
    | "catalogStatus"
    | "catalogError"
    | "saved"
    | "draft"
    | "search"
    | "testing"
    | "testResult"
  >;

  function derive(core: Core): LlmSettingsState<E> {
    const provider = core.catalog?.[core.draft.providerId] ?? null;
    const models = filterCatalogModels(provider, core.search);
    const defaultId = provider?.defaultModel;
    return {
      ...core,
      provider,
      providers: splitProviders(core.catalog, recommendedIds),
      isRecommendedProvider: recommendedIds.includes(core.draft.providerId),
      models,
      recommendedModel: defaultId ? (models.find((m) => m.id === defaultId) ?? null) : null,
      apiKey: activeKey(core.draft),
      canSave: canSave(core.draft),
      canTest: canTest(core.draft),
    };
  }

  let state = derive({
    catalog: null,
    catalogStatus: "idle",
    catalogError: null,
    saved: null,
    draft: draftFrom(null),
    search: "",
    testing: false,
    testResult: null,
  });
  const listeners = new Set<(state: LlmSettingsState<E>) => void>();
  // Whether the user changed the draft since it was last reset
  let edited = false;

  function set(patch: Partial<Core>): void {
    const next: Core = { ...state, ...patch };
    // Nothing chosen yet: take the provider's recommended model once the catalog lists it
    if (!next.draft.model && next.catalog) {
      const model = defaultModelOf(next.catalog[next.draft.providerId]);
      if (model) next.draft = { ...next.draft, model };
    }
    state = derive(next);
    for (const listener of listeners) listener(state);
  }

  function editDraft(patch: Partial<LlmDraft>): void {
    edited = true;
    set({ draft: { ...state.draft, ...patch }, testResult: null });
  }

  function fetchCatalog(): void {
    if (state.catalogStatus === "loading" || state.catalogStatus === "ready") return;
    set({ catalogStatus: "loading", catalogError: null });
    const request =
      typeof catalogSource === "string"
        ? loadCatalog(catalogSource, options.fetch)
        : catalogSource();
    request.then(
      (catalog) => set({ catalog, catalogStatus: "ready", catalogError: null }),
      (error: unknown) =>
        set({
          catalogStatus: "error",
          catalogError: error instanceof Error ? error.message : "Model list unavailable",
        }),
    );
  }

  function meta(): ProviderMeta {
    const { draft, catalog, saved } = state;
    const listed = providerMeta(catalog, draft.providerId);
    if (listed) return listed;
    // Catalog not loaded: keep what was saved for this provider rather than OpenAI's
    if (saved?.providerId === draft.providerId)
      return {
        providerId: draft.providerId,
        providerName: saved.providerName ?? draft.providerId,
        providerNpm: saved.providerNpm ?? "",
        providerApi: saved.providerApi ?? "",
      };
    return DEFAULT_PROVIDER_META;
  }

  function settings(): LlmSettings {
    const { draft } = state;
    return {
      apiKey: activeKey(draft),
      model: draft.model,
      ...meta(),
      language: draft.language,
      ...(draft.custom
        ? {
            customEndpoint: validateEndpoint(draft.customEndpoint) ?? draft.customEndpoint.trim(),
            customModel: draft.customModel.trim(),
          }
        : {}),
    };
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },

    async load() {
      const saved = await (options.storage.loadDraft ?? options.storage.load)();
      // Storage can answer after the user started typing: keep what they typed
      if (edited) set({ saved });
      else set({ saved, draft: draftFrom(saved), search: "", testResult: null });
      return saved;
    },

    reset(saved) {
      edited = false;
      set({ saved, draft: draftFrom(saved), search: "", testResult: null });
    },

    open() {
      edited = false;
      set({ draft: draftFrom(state.saved), search: "", testing: false, testResult: null });
      fetchCatalog();
    },

    retryCatalog: fetchCatalog,

    selectProvider(id) {
      // A model of the previous provider would be sent to the new one
      const model = defaultModelOf(state.catalog?.[id]) ?? "";
      edited = true;
      set({ draft: { ...state.draft, providerId: id, model }, search: "", testResult: null });
    },

    selectModel: (model) => editDraft({ model }),

    setApiKey(key) {
      editDraft(state.draft.custom ? { customApiKey: key } : { apiKey: key });
    },

    setSearch: (search) => set({ search }),

    toggleCustom(on) {
      editDraft({ custom: on ?? !state.draft.custom });
    },

    applyPreset(preset) {
      editDraft({
        customEndpoint: preset.endpoint,
        ...(!state.draft.customModel.trim() && preset.model ? { customModel: preset.model } : {}),
      });
    },

    setEndpoint: (customEndpoint) => editDraft({ customEndpoint }),
    setCustomModel: (customModel) => editDraft({ customModel }),
    setRememberKey: (rememberKey) => editDraft({ rememberKey }),
    setLanguage: (language) => editDraft({ language: toLanguageCode(language) }),

    settings,

    async test(testOptions = {}) {
      set({ testing: true, testResult: null });
      try {
        const result = await testConnection(settings(), {
          mode: options.testMode ?? "models",
          signal: testOptions.signal,
          fetch: options.fetch,
        });
        set({ testing: false, testResult: result });
        return result;
      } catch (error) {
        set({ testing: false });
        throw error;
      }
    },

    async save(extra) {
      const { draft } = state;
      if (!canSave(draft)) return { ok: false, reason: "incomplete" };
      const problem = draft.custom ? endpointProblem(draft.customEndpoint) : null;
      if (problem) return { ok: false, reason: problem };
      const saved = { ...settings(), ...extra } as LlmSettings & E;
      await options.storage.save(saved, { rememberKey: draft.rememberKey });
      const stored = { ...saved, rememberKey: draft.rememberKey } as StoredSettings<E>;
      set({ saved: stored });
      return { ok: true, settings: stored };
    },

    async clear() {
      await options.storage.clear();
      set({
        saved: null,
        draft: {
          ...state.draft,
          custom: false,
          apiKey: "",
          customApiKey: "",
          customEndpoint: "",
          customModel: "",
          language: defaultLanguage(),
        },
        testResult: null,
      });
    },
  };
}
