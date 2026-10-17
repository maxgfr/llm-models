import { describe, expect, it } from "bun:test";
import { CALLABLE_NPM, defaultModelOf, filterCatalogModels, type SlimProvider } from "../catalog";
import { OPENAI_COMPATIBLE_SDKS, slimCatalog } from "../functions/catalog";
import { normalizeModelsDevModel } from "../functions/normalize";
import type { ModelsDevModel, ModelsDevProvider, ModelsDevResponse, UnifiedModel } from "../types";

function devModel(id: string, extra: Partial<ModelsDevModel> = {}): ModelsDevModel {
  return {
    id,
    name: id.toUpperCase(),
    attachment: false,
    reasoning: false,
    tool_call: true,
    open_weights: false,
    release_date: "2026-01-01",
    last_updated: "2026-01-01",
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 128000, output: 16384 },
    cost: { input: 1, output: 2 },
    ...extra,
  };
}

function devProvider(
  id: string,
  npm: string,
  models: ModelsDevModel[],
  api?: string,
): ModelsDevProvider {
  return {
    id,
    name: `${id} name`,
    doc: `https://${id}.example/docs`,
    env: [],
    npm,
    ...(api ? { api } : {}),
    models: Object.fromEntries(models.map((m) => [m.id, m])),
  };
}

const modelsDevData: ModelsDevResponse = {
  openai: devProvider("openai", "@ai-sdk/openai", [
    devModel("gpt-5", { release_date: "2026-03-01", reasoning: true }),
    devModel("gpt-5-mini", { release_date: "2026-03-02" }),
    devModel("gpt-4", { status: "deprecated" }),
  ]),
  anthropic: devProvider("anthropic", "@ai-sdk/anthropic", [
    devModel("claude-opus-5", { family: "claude-opus", release_date: "2026-04-01" }),
    devModel("claude-sonnet-5", { family: "claude-sonnet", release_date: "2026-04-01" }),
  ]),
  // Callable through the generic SDK with its own URL
  zai: devProvider("zai", "@ai-sdk/openai-compatible", [devModel("glm-5")], "https://api.z.ai/v4"),
  // Generic SDK without a URL: cannot be called
  nourl: devProvider("nourl", "@ai-sdk/openai-compatible", [devModel("x-1")]),
  // An SDK the client does not ship
  venice: devProvider("venice", "venice-ai-sdk-provider", [devModel("venice-1")]),
  // Dedicated SDKs whose API is also OpenAI-compatible
  groq: devProvider("groq", "@ai-sdk/groq", [devModel("llama-4")]),
  cohere: devProvider(
    "cohere",
    "@ai-sdk/cohere",
    [devModel("command-a")],
    "https://api.cohere.com/v2",
  ),
  // Only deprecated models left
  old: devProvider("old", "@ai-sdk/openai", [devModel("old-1", { status: "deprecated" })]),
};

const models: UnifiedModel[] = Object.entries(modelsDevData).flatMap(([providerId, provider]) =>
  Object.values(provider.models).map((model) => normalizeModelsDevModel(model, providerId)),
);

const source = { models, modelsDevData };

describe("slimCatalog", () => {
  it("keeps only the providers called through the listed SDKs", () => {
    const catalog = slimCatalog(source, { npm: CALLABLE_NPM });
    expect(Object.keys(catalog)).toEqual(["anthropic", "cohere", "groq", "openai", "zai"]);
    expect(catalog.venice).toBeUndefined();
  });

  it("keeps every SDK when no npm list is given, but never a generic provider without a URL", () => {
    const catalog = slimCatalog(source);
    expect(Object.keys(catalog)).toEqual([
      "anthropic",
      "cohere",
      "groq",
      "openai",
      "venice",
      "zai",
    ]);
    expect(catalog.nourl).toBeUndefined();
    expect(catalog.groq.npm).toBe("@ai-sdk/groq");
  });

  it("keeps OpenAI-compatible providers of other SDKs through the generic one", () => {
    const catalog = slimCatalog(source, { npm: CALLABLE_NPM });
    expect(catalog.groq).toEqual({
      id: "groq",
      name: "groq name",
      npm: "@ai-sdk/openai-compatible",
      api: "https://api.groq.com/openai/v1",
      defaultModel: "llama-4",
      models: { "llama-4": { id: "llama-4", name: "LLAMA-4", tool_call: true } },
    });
    // The compatibility endpoint replaces the native API models.dev lists
    expect(catalog.cohere.npm).toBe("@ai-sdk/openai-compatible");
    expect(catalog.cohere.api).toBe("https://api.cohere.ai/compatibility/v1");
    // Even without the documented defaults: the generic SDK needs the URL
    const bare = slimCatalog(source, { npm: CALLABLE_NPM, fillDefaultApi: false });
    expect(bare.groq.api).toBe("https://api.groq.com/openai/v1");
  });

  it("keeps a provider on its own SDK when that SDK is listed", () => {
    const catalog = slimCatalog(source, { npm: [...CALLABLE_NPM, "@ai-sdk/groq"] });
    expect(catalog.groq.npm).toBe("@ai-sdk/groq");
    expect(catalog.groq.api).toBe("https://api.groq.com/openai/v1");
    expect(catalog.cohere.npm).toBe("@ai-sdk/openai-compatible");
  });

  it("lists no OpenAI-compatible provider when the generic SDK is not allowed", () => {
    const catalog = slimCatalog(source, { npm: ["@ai-sdk/openai", "@ai-sdk/anthropic"] });
    expect(Object.keys(catalog)).toEqual(["anthropic", "openai"]);
  });

  it("does not remap a provider whose models.dev SDK differs from the table's", () => {
    const data: ModelsDevResponse = {
      groq: devProvider("groq", "@acme/groq", [devModel("llama-4")]),
    };
    expect(slimCatalog({ models: [], modelsDevData: data }, { npm: CALLABLE_NPM })).toEqual({});
  });

  it("maps every OpenAI-compatible SDK to an https base URL", () => {
    expect(Object.keys(OPENAI_COMPATIBLE_SDKS).sort()).toEqual([
      "cerebras",
      "cohere",
      "deepinfra",
      "groq",
      "openrouter",
      "perplexity",
      "togetherai",
      "xai",
    ]);
    for (const { sdk, api } of Object.values(OPENAI_COMPATIBLE_SDKS)) {
      expect(sdk).not.toBe("@ai-sdk/openai-compatible");
      expect(api).toMatch(/^https:\/\/[^/]+(\/[^/]+)*$/);
    }
  });

  it("keeps only models a chat can use, unless told otherwise", () => {
    const data: ModelsDevResponse = {
      google: devProvider("google", "@ai-sdk/google", [
        devModel("gemini-3-pro"),
        devModel("veo-3", { modalities: { input: ["text", "image"], output: ["video"] } }),
        devModel("gemini-tts", { modalities: { input: ["text"], output: ["audio"] } }),
        devModel("live-translate", { modalities: { input: ["audio"], output: ["audio", "text"] } }),
        devModel("text-embedding-005"),
        devModel("gemini-embed", { family: "gemini-embedding" }),
      ]),
    };
    const chat = slimCatalog({ models: [], modelsDevData: data });
    expect(Object.keys(chat.google!.models)).toEqual(["gemini-3-pro"]);
    const all = slimCatalog({ models: [], modelsDevData: data }, { chatOnly: false });
    expect(Object.keys(all.google!.models)).toHaveLength(6);
  });

  it("drops deprecated models, and a provider left without any", () => {
    const catalog = slimCatalog(source, { npm: CALLABLE_NPM });
    expect(Object.keys(catalog.openai.models)).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(catalog.old).toBeUndefined();
  });

  it("keeps deprecated models on request", () => {
    const catalog = slimCatalog(source, { dropDeprecated: false });
    expect(Object.keys(catalog.openai.models)).toEqual(["gpt-4", "gpt-5", "gpt-5-mini"]);
    expect(Object.keys(catalog.old.models)).toEqual(["old-1"]);
  });

  it("lists only what a settings form needs", () => {
    const catalog = slimCatalog(source, { npm: CALLABLE_NPM });
    expect(catalog.openai.models["gpt-5"]).toEqual({
      id: "gpt-5",
      name: "GPT-5",
      tool_call: true,
      reasoning: true,
    });
    expect(catalog.zai).toEqual({
      id: "zai",
      name: "zai name",
      npm: "@ai-sdk/openai-compatible",
      api: "https://api.z.ai/v4",
      defaultModel: "glm-5",
      models: { "glm-5": { id: "glm-5", name: "GLM-5", tool_call: true } },
    });
  });

  it("recommends the balanced tier: the fast sibling, or Claude's sonnet", () => {
    const catalog = slimCatalog(source, { npm: CALLABLE_NPM });
    expect(catalog.openai.defaultModel).toBe("gpt-5-mini");
    expect(catalog.anthropic.defaultModel).toBe("claude-sonnet-5");
  });

  it("leaves defaultModel out on request", () => {
    const catalog = slimCatalog(source, { npm: CALLABLE_NPM, defaultModel: false });
    expect(Object.values(catalog).some((p) => "defaultModel" in p)).toBe(false);
  });

  it("fills the documented base URL of providers whose SDK has one", () => {
    const catalog = slimCatalog(source, { npm: CALLABLE_NPM });
    expect(catalog.openai.api).toBe("https://api.openai.com/v1");
    expect(catalog.anthropic.api).toBe("https://api.anthropic.com/v1");
    const bare = slimCatalog(source, { npm: CALLABLE_NPM, fillDefaultApi: false });
    expect(bare.openai.api).toBeUndefined();
    expect(bare.zai.api).toBe("https://api.z.ai/v4");
  });

  it("throws when a required provider is missing", () => {
    expect(() => slimCatalog(source, { npm: CALLABLE_NPM, required: ["openai"] })).not.toThrow();
    expect(() =>
      slimCatalog(source, { npm: CALLABLE_NPM, required: ["openai", "venice", "old"] }),
    ).toThrow("Catalog is missing required providers: venice, old");
  });

  it("writes the same JSON whatever the input order", () => {
    const reversed: ModelsDevResponse = Object.fromEntries(
      Object.entries(modelsDevData)
        .reverse()
        .map(([id, provider]) => [
          id,
          { ...provider, models: Object.fromEntries(Object.entries(provider.models).reverse()) },
        ]),
    );
    const a = JSON.stringify(slimCatalog(source, { npm: CALLABLE_NPM }));
    const b = JSON.stringify(
      slimCatalog(
        { models: [...models].reverse(), modelsDevData: reversed },
        { npm: CALLABLE_NPM },
      ),
    );
    expect(b).toBe(a);
  });
});

describe("catalog helpers", () => {
  const provider: SlimProvider = {
    id: "p",
    name: "P",
    npm: "@ai-sdk/openai",
    defaultModel: "b",
    models: {
      a: { id: "a", name: "Alpha" },
      b: { id: "b", name: "Beta" },
    },
  };

  it("defaultModelOf returns the recommended model, else the first one", () => {
    expect(defaultModelOf(provider)).toBe("b");
    expect(defaultModelOf({ ...provider, defaultModel: "gone" })).toBe("a");
    expect(defaultModelOf({ ...provider, defaultModel: undefined })).toBe("a");
    expect(defaultModelOf({ ...provider, models: {} })).toBeUndefined();
    expect(defaultModelOf(undefined)).toBeUndefined();
  });

  it("filterCatalogModels matches the name or the id, ignoring case", () => {
    expect(filterCatalogModels(provider, "").map((m) => m.id)).toEqual(["a", "b"]);
    expect(filterCatalogModels(provider, " ALP ").map((m) => m.id)).toEqual(["a"]);
    expect(filterCatalogModels(provider, "b").map((m) => m.id)).toEqual(["b"]);
    expect(filterCatalogModels(null, "a")).toEqual([]);
  });
});
