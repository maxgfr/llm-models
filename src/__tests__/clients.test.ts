import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { setCacheEnabled } from "../cache";
import { fetchModelsDevModels } from "../clients/models-dev";
import { fetchOpenRouterModels } from "../clients/openrouter";

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
