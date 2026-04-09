import { afterEach, describe, expect, it, mock } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

function mockBothAPIs() {
  globalThis.fetch = mock((url: string) => {
    if (url.includes("openrouter")) {
      return Promise.resolve(new Response(JSON.stringify(mockOpenRouterResponse), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(mockModelsDevResponse), { status: 200 }));
  }) as typeof fetch;
}

describe("estimateCost", () => {
  it("calculates cost correctly", async () => {
    mockBothAPIs();
    const { estimateCost } = await import("../functions/cost");

    const result = await estimateCost({
      modelIds: ["openai/gpt-4o"],
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    });

    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("openai/gpt-4o");
    expect(result[0].input_cost_usd).toBeCloseTo(2.5);
    expect(result[0].output_cost_usd).toBeCloseTo(1.0);
    expect(result[0].total_cost_usd).toBeCloseTo(3.5);
  });

  it("throws for unknown model", async () => {
    mockBothAPIs();
    const { estimateCost } = await import("../functions/cost");

    expect(
      estimateCost({
        modelIds: ["nonexistent/model"],
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).rejects.toThrow("not found");
  });
});
