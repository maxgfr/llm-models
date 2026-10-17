import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCacheDir, setCacheDir, setCacheEnabled } from "../cache";
import { fetchModelsDevModels, parseModelsDevResponse } from "../clients/models-dev";
import { fetchOpenRouterModels, parseOpenRouterResponse } from "../clients/openrouter";
import { buildSlimCatalog } from "../functions/catalog";
import { fetchUnifiedData } from "../functions/normalize";

beforeAll(() => {
  setCacheEnabled(false);
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchOpenRouterModels", () => {
  it("should throw on non-200 response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" })),
    );

    expect(fetchOpenRouterModels()).rejects.toThrow("OpenRouter API error: 404 Not Found");
  });

  it("should throw on invalid JSON structure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ invalid: true }), { status: 200 })),
    );

    expect(fetchOpenRouterModels()).rejects.toThrow();
  });

  it("should parse valid response", async () => {
    const mockData = {
      data: [
        {
          id: "test/model",
          canonical_slug: "test/model-v1",
          name: "Test Model",
          description: "A test model",
          created: 1700000000,
          context_length: 4096,
          hugging_face_id: null,
          knowledge_cutoff: null,
          expiration_date: null,
          per_request_limits: null,
          supported_parameters: ["temperature"],
          architecture: {
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
            tokenizer: "GPT",
            instruct_type: null,
          },
          pricing: {
            prompt: "0.001",
            completion: "0.002",
          },
          top_provider: {
            context_length: 4096,
            max_completion_tokens: 2048,
            is_moderated: false,
          },
          default_parameters: null,
          links: {
            details: "/api/v1/models/test/model-v1/endpoints",
          },
        },
      ],
    };

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockData), { status: 200 })),
    );

    const result = await fetchOpenRouterModels();
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("test/model");
  });
});

describe("fetchModelsDevModels", () => {
  it("should throw on non-200 response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }),
      ),
    );

    expect(fetchModelsDevModels()).rejects.toThrow(
      "models.dev API error: 500 Internal Server Error",
    );
  });

  it("should throw on invalid JSON structure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify([1, 2, 3]), { status: 200 })),
    );

    expect(fetchModelsDevModels()).rejects.toThrow();
  });

  it("should parse valid response", async () => {
    const mockData = {
      openai: {
        id: "openai",
        name: "OpenAI",
        doc: "https://openai.com/docs",
        env: ["OPENAI_API_KEY"],
        npm: "@ai-sdk/openai",
        api: "https://api.openai.com/v1",
        models: {
          "gpt-4o": {
            id: "gpt-4o",
            name: "GPT-4o",
            attachment: true,
            reasoning: false,
            tool_call: true,
            open_weights: false,
            release_date: "2024-05-13",
            last_updated: "2024-11-20",
            modalities: { input: ["text", "image"], output: ["text"] },
            limit: { context: 128000, output: 16384 },
            family: "gpt",
            cost: { input: 2.5, output: 10 },
          },
        },
      },
    };

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockData), { status: 200 })),
    );

    const result = await fetchModelsDevModels();
    expect(Object.keys(result)).toHaveLength(1);
    expect(result.openai.name).toBe("OpenAI");
    expect(Object.keys(result.openai.models)).toHaveLength(1);
  });
});

const validOpenRouterModel = {
  id: "test/model",
  canonical_slug: "test/model",
  name: "Test Model",
  description: "A test model",
  created: 1700000000,
  context_length: 4096,
  supported_parameters: [],
  architecture: {
    modality: "text->text",
    input_modalities: ["text"],
    output_modalities: ["text"],
    tokenizer: "GPT",
  },
  pricing: { prompt: "0.001", completion: "0.002" },
  top_provider: { context_length: 4096, max_completion_tokens: 2048, is_moderated: false },
  links: { details: "/test" },
};

const validModelsDevModel = {
  id: "good",
  name: "Good",
  attachment: false,
  reasoning: false,
  tool_call: true,
  open_weights: false,
  release_date: "2024-05-13",
  last_updated: "2024-05-13",
  modalities: { input: ["text"], output: ["text"] },
  limit: { context: 1000, output: 100 },
};

const provider = (models: Record<string, unknown>) => ({
  id: "acme",
  name: "Acme",
  doc: "https://acme.example",
  env: ["ACME_API_KEY"],
  npm: "@ai-sdk/acme",
  models,
});

describe("tolerant parsing", () => {
  it("drops an invalid OpenRouter entry and keeps the rest", () => {
    const result = parseOpenRouterResponse({
      data: [validOpenRouterModel, { id: "broken/model" }],
    });
    expect(result.data.map((m) => m.id)).toEqual(["test/model"]);
  });

  it("throws when no OpenRouter entry is valid", () => {
    expect(() => parseOpenRouterResponse({ data: [{ id: "broken" }] })).toThrow("no valid models");
  });

  it("drops one invalid models.dev model without losing its provider", () => {
    const result = parseModelsDevResponse({
      acme: provider({ good: validModelsDevModel, bad: { id: "bad" } }),
    });
    expect(Object.keys(result.acme.models)).toEqual(["good"]);
  });

  it("drops an invalid models.dev provider and keeps the others", () => {
    const result = parseModelsDevResponse({
      acme: provider({ good: validModelsDevModel }),
      broken: { id: "broken" },
    });
    expect(Object.keys(result)).toEqual(["acme"]);
  });

  it("throws when no models.dev model is valid", () => {
    expect(() => parseModelsDevResponse({ acme: provider({ bad: {} }) })).toThrow(
      "no valid models",
    );
  });
});

describe("fetch behaviour", () => {
  it("sends a User-Agent and a timeout signal", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = mock((_url: string, options?: RequestInit) => {
      init = options;
      return Promise.resolve(
        new Response(JSON.stringify({ data: [validOpenRouterModel] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    await fetchOpenRouterModels();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^llm-models\/\d+\.\d+\.\d+/);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a timeout explicitly", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    ) as unknown as typeof fetch;

    expect(fetchModelsDevModels()).rejects.toThrow("models.dev API timed out after 15s");
  });
});

describe("fetchUnifiedData with one API down", () => {
  it("warns on stderr instead of silently dropping a source", async () => {
    const realDir = getCacheDir();
    const emptyDir = mkdtempSync(join(tmpdir(), "llm-models-empty-"));
    setCacheDir(emptyDir); // no expired cache to fall back on
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (message: string) => errors.push(message);
    globalThis.fetch = mock((url: string) =>
      Promise.resolve(
        url.includes("openrouter")
          ? new Response("down", { status: 503, statusText: "Service Unavailable" })
          : new Response(JSON.stringify({ acme: provider({ good: validModelsDevModel }) }), {
              status: 200,
            }),
      ),
    ) as unknown as typeof fetch;

    try {
      const { models } = await fetchUnifiedData();
      expect(models.map((m) => m.id)).toEqual(["acme/good"]);
      expect(errors.join("\n")).toContain(
        "OpenRouter API unavailable (OpenRouter API error: 503 Service Unavailable), showing models.dev data only",
      );
    } finally {
      console.error = originalError;
      setCacheDir(realDir);
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("fetchUnifiedData model pairing", () => {
  it("pairs OpenRouter's own models with models.dev's openrouter entries, one model and one api_id each", async () => {
    globalThis.fetch = mock((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes("openrouter")
              ? {
                  data: [
                    {
                      ...validOpenRouterModel,
                      id: "openrouter/auto",
                      canonical_slug: "openrouter/auto",
                    },
                    { ...validOpenRouterModel, id: "acme/good", canonical_slug: "acme/good" },
                    {
                      ...validOpenRouterModel,
                      id: "acme/good:batch",
                      canonical_slug: "acme/good:batch",
                    },
                  ],
                }
              : {
                  acme: provider({ good: validModelsDevModel }),
                  openrouter: {
                    ...provider({
                      "openrouter/auto": {
                        ...validModelsDevModel,
                        id: "openrouter/auto",
                        name: "Auto",
                      },
                      "acme/good": { ...validModelsDevModel, id: "acme/good" },
                    }),
                    id: "openrouter",
                  },
                },
          ),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    const { models } = await fetchUnifiedData();
    const byId = new Map(models.map((m) => [m.id, m]));
    expect(
      models
        .filter((m) => m.provider === "openrouter")
        .map((m) => m.api_id)
        .sort(),
    ).toEqual(["acme/good", "openrouter/auto"]);
    expect(byId.get("openrouter/openrouter/auto")?.sources).toEqual({
      openrouter: true,
      models_dev: true,
    });
    expect(byId.has("openrouter/auto")).toBe(false);
    expect(byId.get("acme/good")?.api_id).toBe("good");
    expect(byId.get("acme/good:batch")?.api_id).toBeUndefined();
  });
});

describe("a fetch passed in", () => {
  it("downloads both APIs through it, never through the global fetch", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("global fetch must not be called")),
    ) as unknown as typeof fetch;
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(String(input));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(
        JSON.stringify(
          String(input).includes("openrouter")
            ? { data: [{ ...validOpenRouterModel, id: "acme/good", canonical_slug: "acme/good" }] }
            : { acme: { ...provider({ good: validModelsDevModel }), npm: "@ai-sdk/openai" } },
        ),
        { status: 200 },
      );
    }) as typeof fetch;

    const catalog = await buildSlimCatalog({ fetch: fetchImpl, npm: ["@ai-sdk/openai"] });
    expect(requested.sort()).toEqual([
      "https://models.dev/api.json",
      "https://openrouter.ai/api/v1/models",
    ]);
    expect(Object.keys(catalog)).toEqual(["acme"]);
    expect(Object.keys(catalog.acme?.models ?? {})).toEqual(["good"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
