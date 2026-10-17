import { beforeEach, describe, expect, it } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { SlimCatalog } from "llm-models/catalog";
import { clearCatalogCache } from "../catalog-client.js";
import { clearProviders, registerProvider } from "../registry.js";
import { ENDPOINT_PRESETS } from "../settings.js";
import type { SettingsStorage, StoredSettings } from "../storage.js";
import { createLlmSettingsStore, type LlmStoreOptions } from "../store.js";

const catalog: SlimCatalog = {
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
    models: {
      "gpt-5": { id: "gpt-5", name: "GPT-5" },
      "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5 mini" },
    },
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    api: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    models: {
      "claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5" },
      "claude-sonnet-5": { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    },
  },
  zai: {
    id: "zai",
    name: "Z.ai",
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.z.ai/api/paas/v4",
    models: { "glm-5": { id: "glm-5", name: "GLM-5" } },
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.deepseek.com",
    models: { "deepseek-v4": { id: "deepseek-v4", name: "DeepSeek V4" } },
  },
};

/** In-memory storage recording every save. */
function memoryStorage(initial: StoredSettings<{ language?: string }> | null = null) {
  let saved = initial;
  const saves: { settings: unknown; rememberKey: boolean }[] = [];
  const storage: SettingsStorage<{ language?: string }> = {
    load: async () => saved,
    save: async (settings, { rememberKey }) => {
      saves.push({ settings, rememberKey });
      saved = { ...settings, rememberKey };
    },
    clear: async () => {
      saved = null;
    },
  };
  return { storage, saves };
}

/** A catalog server that fails `failures` times before answering. */
function catalogFetch(failures = 0) {
  let requests = 0;
  const fetch = (async (input: RequestInfo | URL) => {
    requests++;
    if (String(input) !== "/models.json") return new Response("", { status: 404 });
    if (requests <= failures) return new Response("", { status: 503 });
    return new Response(JSON.stringify(catalog));
  }) as typeof fetch;
  return { fetch, requests: () => requests };
}

function makeStore(options: Partial<LlmStoreOptions<{ language?: string }>> = {}, failures = 0) {
  const server = catalogFetch(failures);
  const memory = memoryStorage();
  const store = createLlmSettingsStore<{ language?: string }>({
    catalogUrl: "/models.json",
    storage: memory.storage,
    recommended: ["openai", "anthropic"],
    fetch: server.fetch,
    ...options,
  });
  return { store, server, saves: memory.saves };
}

/** Resolves once the store's catalog has settled. */
function settled(store: ReturnType<typeof makeStore>["store"]) {
  return new Promise<void>((resolve) => {
    const stop = store.subscribe((state) => {
      if (state.catalogStatus === "ready" || state.catalogStatus === "error") {
        queueMicrotask(() => stop());
        resolve();
      }
    });
  });
}

beforeEach(() => clearCatalogCache());

describe("createLlmSettingsStore", () => {
  it("calls a subscriber at once and on every change, until it unsubscribes", () => {
    const { store } = makeStore();
    const seen: string[] = [];
    const stop = store.subscribe((state) => seen.push(state.draft.model));
    store.selectModel("a");
    stop();
    store.selectModel("b");
    expect(seen).toEqual(["", "a"]);
    expect(store.getState().draft.model).toBe("b");
  });

  it("downloads the catalog on open, picks the default model, and splits providers", async () => {
    const { store, server } = makeStore();
    expect(store.getState().catalogStatus).toBe("idle");
    store.open();
    expect(store.getState().catalogStatus).toBe("loading");
    await settled(store);

    const state = store.getState();
    expect(state.catalogStatus).toBe("ready");
    expect(state.draft.providerId).toBe("openai");
    expect(state.draft.model).toBe("gpt-5-mini");
    expect(state.providers.recommended.map((p) => p.id)).toEqual(["openai", "anthropic"]);
    expect(state.providers.others.map((p) => p.id)).toEqual(["deepseek", "zai"]);
    expect(state.recommendedModel?.id).toBe("gpt-5-mini");

    store.open();
    expect(server.requests()).toBe(1);
  });

  it("keeps an error until retried", async () => {
    const { store, server } = makeStore({}, 1);
    store.open();
    await settled(store);
    expect(store.getState().catalogStatus).toBe("error");
    expect(store.getState().catalogError).toBe("Model list unavailable (503)");

    store.retryCatalog();
    await settled(store);
    expect(store.getState().catalogStatus).toBe("ready");
    expect(server.requests()).toBe(2);
  });

  it("switches provider with its recommended model, or its first one", async () => {
    const { store } = makeStore();
    store.open();
    await settled(store);
    store.setSearch("opus");
    store.selectProvider("anthropic");
    expect(store.getState().draft.model).toBe("claude-sonnet-5");
    expect(store.getState().search).toBe("");
    expect(store.getState().isRecommendedProvider).toBe(true);
    store.selectProvider("zai");
    expect(store.getState().draft.model).toBe("glm-5");
    expect(store.getState().isRecommendedProvider).toBe(false);
  });

  it("filters models by search, hiding a recommended model that does not match", async () => {
    const { store } = makeStore();
    store.open();
    await settled(store);
    store.setSearch("GPT-5 ");
    expect(store.getState().models.map((m) => m.id)).toEqual(["gpt-5", "gpt-5-mini"]);
    store.setSearch("mini");
    expect(store.getState().recommendedModel?.id).toBe("gpt-5-mini");
    store.setSearch("zzz");
    expect(store.getState().models).toEqual([]);
    expect(store.getState().recommendedModel).toBeNull();
  });

  it("keeps the provider key and the endpoint key in two slots", () => {
    const { store } = makeStore();
    store.setApiKey("sk-provider");
    store.toggleCustom();
    expect(store.getState().apiKey).toBe("");
    store.setApiKey("lm-key");
    store.toggleCustom(false);
    expect(store.getState().apiKey).toBe("sk-provider");
    store.toggleCustom(true);
    expect(store.getState().apiKey).toBe("lm-key");
  });

  it("applies a preset without overwriting a model already typed", () => {
    const { store } = makeStore();
    store.toggleCustom(true);
    store.applyPreset(ENDPOINT_PRESETS.ollama);
    expect(store.getState().draft).toMatchObject({
      customEndpoint: "http://localhost:11434/v1",
      customModel: "llama3.2",
    });
    store.setCustomModel("qwen3");
    store.applyPreset(ENDPOINT_PRESETS.lmstudio);
    expect(store.getState().draft).toMatchObject({
      customEndpoint: "http://localhost:1234/v1",
      customModel: "qwen3",
    });
  });

  it("knows when the draft can be tested and saved", async () => {
    const { store } = makeStore();
    store.open();
    await settled(store);
    expect(store.getState()).toMatchObject({ canSave: false, canTest: false });
    store.setApiKey("sk");
    expect(store.getState()).toMatchObject({ canSave: true, canTest: true });
    store.toggleCustom(true);
    store.setEndpoint("http://localhost:11434/v1");
    expect(store.getState()).toMatchObject({ canSave: false, canTest: true });
    store.setCustomModel("llama3.2");
    expect(store.getState()).toMatchObject({ canSave: true, canTest: true });
  });

  it("saves the provider's metadata and the app's own fields", async () => {
    const { store, saves } = makeStore({ defaults: { rememberKey: true } });
    store.open();
    await settled(store);
    store.selectProvider("anthropic");
    store.setApiKey("sk-ant");
    const result = await store.save({ language: "fr" });
    expect(result.ok).toBe(true);
    expect(saves).toEqual([
      {
        settings: {
          apiKey: "sk-ant",
          model: "claude-sonnet-5",
          providerId: "anthropic",
          providerName: "Anthropic",
          providerNpm: "@ai-sdk/anthropic",
          providerApi: "https://api.anthropic.com/v1",
          language: "fr",
        },
        rememberKey: true,
      },
    ]);
    expect(store.getState().saved).toMatchObject({ providerId: "anthropic", rememberKey: true });
  });

  it("saves a custom endpoint normalized, and refuses an invalid one", async () => {
    const { store, saves } = makeStore();
    store.toggleCustom(true);
    store.setEndpoint("localhost:11434");
    store.setCustomModel("llama3.2");
    expect(await store.save()).toEqual({ ok: false, reason: "invalid-endpoint" });
    store.setEndpoint(" http://localhost:11434/v1/ ");
    expect((await store.save()).ok).toBe(true);
    expect(saves[0].settings).toMatchObject({
      apiKey: "",
      customEndpoint: "http://localhost:11434/v1",
      customModel: "llama3.2",
    });
    expect(await makeStore().store.save()).toEqual({ ok: false, reason: "incomplete" });
  });

  it("loads saved settings into the draft and drops unsaved edits on open", async () => {
    const memory = memoryStorage({
      apiKey: "lm",
      model: "gpt-5",
      providerId: "openai",
      customEndpoint: "http://localhost:1234/v1",
      customModel: "qwen3",
      rememberKey: true,
      language: "de",
    });
    const store = createLlmSettingsStore({
      catalogUrl: "/models.json",
      storage: memory.storage,
      fetch: catalogFetch().fetch,
    });
    expect((await store.load())?.language).toBe("de");
    expect(store.getState().draft).toMatchObject({
      custom: true,
      customApiKey: "lm",
      apiKey: "",
      customModel: "qwen3",
      rememberKey: true,
    });
    store.setCustomModel("other");
    store.open();
    expect(store.getState().draft.customModel).toBe("qwen3");
  });

  it("does not let a late load overwrite what the user typed after open", async () => {
    let answer: (value: StoredSettings | null) => void = () => {};
    const store = createLlmSettingsStore({
      catalogUrl: "/models.json",
      storage: {
        load: () => new Promise((resolve) => (answer = resolve)),
        save: async () => {},
        clear: async () => {},
      },
      fetch: catalogFetch().fetch,
    });
    store.open();
    const loading = store.load();
    store.setApiKey("typed");
    answer({ apiKey: "", model: "gpt-5", providerId: "openai" });
    await loading;
    expect(store.getState().draft.apiKey).toBe("typed");
    expect(store.getState().saved?.model).toBe("gpt-5");

    // A new open starts from what was saved
    store.open();
    expect(store.getState().draft).toMatchObject({ apiKey: "", model: "gpt-5" });
  });

  it("resets to settings held by the app", () => {
    const { store } = makeStore();
    store.setApiKey("typed");
    store.reset({ apiKey: "sk", model: "gpt-5", providerId: "openai", rememberKey: true });
    expect(store.getState().draft).toMatchObject({
      apiKey: "sk",
      model: "gpt-5",
      rememberKey: true,
    });
    expect(store.getState().saved?.apiKey).toBe("sk");
    store.reset(null);
    expect(store.getState().draft.apiKey).toBe("");
  });

  it("keeps the saved provider's metadata while the catalog is unavailable", async () => {
    const memory = memoryStorage({
      apiKey: "sk",
      model: "claude-sonnet-5",
      providerId: "anthropic",
      providerName: "Anthropic",
      providerNpm: "@ai-sdk/anthropic",
      providerApi: "https://api.anthropic.com/v1",
    });
    const store = createLlmSettingsStore({
      catalogUrl: "/missing.json",
      storage: memory.storage,
      fetch: catalogFetch().fetch,
    });
    await store.load();
    expect(store.settings()).toMatchObject({
      providerNpm: "@ai-sdk/anthropic",
      providerApi: "https://api.anthropic.com/v1",
    });
    store.selectProvider("mistral");
    expect(store.settings().providerNpm).toBe("@ai-sdk/openai");
  });

  it("tests the draft and records the result", async () => {
    const calls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "llama3.2" }] }));
    }) as typeof globalThis.fetch;
    const store = createLlmSettingsStore({
      catalogUrl: "/models.json",
      storage: memoryStorage().storage,
      fetch,
    });
    store.toggleCustom(true);
    store.setEndpoint("http://localhost:11434/v1");
    const pending = store.test();
    expect(store.getState().testing).toBe(true);
    expect(await pending).toMatchObject({ ok: true, modelCount: 1 });
    expect(store.getState()).toMatchObject({ testing: false, testResult: { ok: true } });
    expect(calls).toEqual(["http://localhost:11434/v1/models"]);
    // An edit makes the result stale
    store.setCustomModel("x");
    expect(store.getState().testResult).toBeNull();
  });

  it("clears the saved settings, the keys and the endpoint", async () => {
    const { store } = makeStore();
    store.setApiKey("sk");
    await store.save();
    store.toggleCustom(true);
    store.setEndpoint("http://localhost:11434/v1");
    await store.clear();
    expect(store.getState().saved).toBeNull();
    expect(store.getState().draft).toMatchObject({
      custom: false,
      apiKey: "",
      customApiKey: "",
      customEndpoint: "",
    });
  });

  it("takes a catalog loader, or a URL under the deprecated catalogUrl", async () => {
    const store = createLlmSettingsStore({
      catalog: async () => catalog,
      storage: memoryStorage().storage,
    });
    store.open();
    await settled(store);
    expect(store.getState().catalogStatus).toBe("ready");
    // OpenAI, Anthropic, Google, Mistral by default: two of them in this catalog
    expect(store.getState().providers.recommended.map((p) => p.id)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(() => createLlmSettingsStore({ storage: memoryStorage().storage })).toThrow("catalog");
  });

  it("edits, saves and clears the response language", async () => {
    const { store, saves } = makeStore({ defaults: { language: "French" } });
    expect(store.getState().draft.language).toBe("fr");
    store.setLanguage("German");
    expect(store.getState().draft.language).toBe("de");
    store.setApiKey("sk");
    store.selectModel("gpt-5");
    expect((await store.save()).ok).toBe(true);
    expect(saves[0].settings).toMatchObject({ language: "de" });

    // Older settings stored the name
    store.reset({ apiKey: "sk", model: "gpt-5", language: "Japanese" });
    expect(store.getState().draft.language).toBe("ja");

    await store.clear();
    expect(store.getState().draft.language).toBe("fr");
  });

  it("refuses to save plain http to another machine", async () => {
    const { store, saves } = makeStore();
    store.toggleCustom(true);
    store.setCustomModel("llama3.2");
    store.setEndpoint("http://192.168.1.10/v1");
    expect(await store.save()).toEqual({ ok: false, reason: "insecure-endpoint" });
    store.setEndpoint("https://192.168.1.10/v1");
    expect((await store.save()).ok).toBe(true);
    expect(saves).toHaveLength(1);
  });

  it("tests a provider through its model list by default, without spending tokens", async () => {
    clearProviders();
    const prompts: unknown[] = [];
    registerProvider("openai", () => {
      return new MockLanguageModelV4({
        doGenerate: async (options) => {
          prompts.push(options.prompt);
          return {
            content: [{ type: "text", text: "OK" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            warnings: [],
          };
        },
      });
    });
    const calls: { url: string; authorization: string | null }[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] }));
    }) as typeof globalThis.fetch;

    const store = createLlmSettingsStore({
      catalog: async () => catalog,
      storage: memoryStorage().storage,
      fetch,
    });
    store.setApiKey("sk");
    expect(await store.test()).toEqual({
      ok: true,
      modelCount: 2,
      models: ["gpt-5", "gpt-5-mini"],
    });
    expect(calls).toEqual([
      { url: "https://api.openai.com/v1/models", authorization: "Bearer sk" },
    ]);
    expect(prompts).toHaveLength(0);

    // A generation only when the app asks for one
    calls.length = 0;
    const generating = createLlmSettingsStore({
      catalog: async () => catalog,
      storage: memoryStorage().storage,
      testMode: "generate",
      fetch,
    });
    generating.setApiKey("sk");
    expect(await generating.test()).toEqual({ ok: true });
    expect(prompts).toHaveLength(1);
    expect(calls).toEqual([]);
    clearProviders();
  });

  it("never calls an insecure endpoint, whatever the test mode", async () => {
    clearProviders();
    const prompts: unknown[] = [];
    registerProvider("openai", () => {
      return new MockLanguageModelV4({
        doGenerate: async (options) => {
          prompts.push(options.prompt);
          throw new Error("must not be called");
        },
      });
    });
    const calls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("{}");
    }) as typeof globalThis.fetch;
    for (const testMode of ["models", "auto", "generate"] as const) {
      const store = createLlmSettingsStore({
        catalog: async () => catalog,
        storage: memoryStorage().storage,
        testMode,
        fetch,
      });
      store.toggleCustom(true);
      store.setEndpoint("http://192.168.1.10/v1");
      expect(await store.test()).toMatchObject({ ok: false, reason: "insecure" });
    }
    expect(calls).toEqual([]);
    expect(prompts).toEqual([]);
    clearProviders();
  });
});
