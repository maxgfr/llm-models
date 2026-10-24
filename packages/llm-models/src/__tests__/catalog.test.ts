import { describe, expect, it } from "bun:test";
import { CALLABLE_NPM, defaultModelOf, filterCatalogModels, type SlimProvider } from "../catalog";
import { isUsableBaseUrl, OPENAI_COMPATIBLE_SDKS, slimCatalog } from "../functions/catalog";
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

  it("lists the input modalities of a model that takes more than text", () => {
    const vision = slimCatalog(
      {
        modelsDevData: {
          openai: devProvider("openai", "@ai-sdk/openai", [
            devModel("gpt-5", {
              modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            }),
            devModel("gpt-5-mini"),
          ]),
        },
        models: [],
      },
      { npm: CALLABLE_NPM, defaultModel: false },
    );
    expect(vision.openai.models["gpt-5"].input).toEqual(["text", "image", "pdf"]);
    expect(vision.openai.models["gpt-5-mini"]).not.toHaveProperty("input");
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

describe("unusable base URLs", () => {
  const unusable: Record<string, string> = {
    cloudflare: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    databricks: "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1",
    neon: "${NEON_AI_GATEWAY_BASE_URL}/v1",
    braces: "https://api.example.com/{region}/v1",
    angle: "https://<account>.example.com/v1",
    plainhttp: "http://api.example.com/v1",
    lmstudio: "http://127.0.0.1:1234/v1",
    privatemode: "http://localhost:8080/v1",
    httpslocalhost: "https://localhost:8443/v1",
    loopback: "https://127.0.0.2/v1",
    ipv6: "https://[::1]:8080/v1",
    ten: "https://10.1.2.3/v1",
    lan172: "https://172.20.0.5/v1",
    lan192: "https://192.168.1.10/v1",
    mdns: "https://gpu-box.local/v1",
    garbage: "not a url",
  };
  const usable: Record<string, string> = {
    zai: "https://api.z.ai/api/paas/v4",
    public172: "https://172.32.0.1/v1",
    public10host: "https://10x.example.com/v1",
    publicip: "https://8.8.8.8/v1",
  };

  it("accepts only https URLs on a public host with nothing left to fill", () => {
    for (const api of Object.values(unusable))
      expect([api, isUsableBaseUrl(api)]).toEqual([api, false]);
    for (const api of Object.values(usable))
      expect([api, isUsableBaseUrl(api)]).toEqual([api, true]);
  });

  it("leaves providers with an unusable base URL out of the catalog", () => {
    const data: ModelsDevResponse = Object.fromEntries(
      Object.entries({ ...unusable, ...usable }).map(([id, api]) => [
        id,
        devProvider(id, "@ai-sdk/openai-compatible", [devModel(`${id}-1`)], api),
      ]),
    );
    const sorted = Object.keys(usable).sort();
    expect(
      Object.keys(slimCatalog({ models: [], modelsDevData: data }, { npm: CALLABLE_NPM })),
    ).toEqual(sorted);
    expect(Object.keys(slimCatalog({ models: [], modelsDevData: data }))).toEqual(sorted);
  });

  it("judges the URL of any SDK, and keeps a native SDK without one", () => {
    const data: ModelsDevResponse = {
      local: devProvider("local", "@ai-sdk/openai", [devModel("l-1")], "http://localhost:11434/v1"),
      native: devProvider("native", "@ai-sdk/anthropic", [devModel("n-1")]),
    };
    expect(
      Object.keys(slimCatalog({ models: [], modelsDevData: data }, { fillDefaultApi: false })),
    ).toEqual(["native"]);
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
