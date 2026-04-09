import { afterEach, describe, expect, it, mock } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Mock data for both APIs
const mockOpenRouterResponse = {
  data: [
    {
      id: "openai/gpt-4o",
      canonical_slug: "openai/gpt-4o",
      name: "GPT-4o",
      description: "Test",
      created: 1700000000,
      context_length: 128000,
      supported_parameters: [],
      architecture: {
        modality: "text->text",
        input_modalities: ["text"],
        output_modalities: ["text"],
        tokenizer: "GPT",
      },
      pricing: { prompt: "0.0000025", completion: "0.00001" },
      top_provider: { context_length: 128000, max_completion_tokens: 16384, is_moderated: false },
      links: { details: "/test" },
    },
    {
      id: "anthropic/claude-sonnet-4",
      canonical_slug: "anthropic/claude-sonnet-4",
      name: "Claude Sonnet 4",
      description: "Test",
      created: 1700000000,
      context_length: 200000,
      supported_parameters: [],
      architecture: {
        modality: "text->text",
        input_modalities: ["text"],
        output_modalities: ["text"],
        tokenizer: "Claude",
      },
      pricing: { prompt: "0.000003", completion: "0.000015" },
      top_provider: { context_length: 200000, max_completion_tokens: 8192, is_moderated: false },
      links: { details: "/test" },
    },
  ],
};

const mockModelsDevResponse = {
  openai: {
    id: "openai",
    name: "OpenAI",
    doc: "https://openai.com/docs",
    env: ["OPENAI_API_KEY"],
    npm: "@ai-sdk/openai",
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
        cost: { input: 2.5, output: 10 },
      },
    },
  },
};

function mockFetchForBothAPIs() {
  globalThis.fetch = mock((url: string) => {
    if (url.includes("openrouter")) {
      return Promise.resolve(new Response(JSON.stringify(mockOpenRouterResponse), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(mockModelsDevResponse), { status: 200 }));
  }) as typeof fetch;
}

describe("compareModels", () => {
  it("compares two models and finds best in each dimension", async () => {
    mockFetchForBothAPIs();
    const { compareModels } = await import("../functions/compare");

    const result = await compareModels(["openai/gpt-4o", "anthropic/claude-sonnet-4"]);

    expect(result.models).toHaveLength(2);
    expect(result.dimensions.context_length.best).toBe("anthropic/claude-sonnet-4");
    expect(result.dimensions.cost_input.best).toBe("openai/gpt-4o");
    expect(result.dimensions.cost_output.best).toBe("openai/gpt-4o");
  });

  it("throws for unknown model", async () => {
    mockFetchForBothAPIs();
    const { compareModels } = await import("../functions/compare");

    expect(compareModels(["nonexistent/model", "openai/gpt-4o"])).rejects.toThrow("not found");
  });

  it("throws when less than 2 models", async () => {
    const { compareModels } = await import("../functions/compare");
    expect(compareModels(["openai/gpt-4o"])).rejects.toThrow("At least 2 models");
  });
});
