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

describe("getProvider", () => {
  it("returns provider info with models", async () => {
    mockBothAPIs();
    const { getProvider } = await import("../functions/provider");

    const result = await getProvider("openai");
    expect(result.id).toBe("openai");
    expect(result.name).toBe("OpenAI");
    expect(result.npm).toBe("@ai-sdk/openai");
    expect(result.env).toEqual(["OPENAI_API_KEY"]);
    expect(result.api).toBe("https://api.openai.com/v1");
    expect(result.model_count).toBe(1);
    expect(result.models).toHaveLength(1);
  });

  it("throws for unknown provider", async () => {
    mockBothAPIs();
    const { getProvider } = await import("../functions/provider");

    expect(getProvider("nonexistent")).rejects.toThrow("not found");
  });
});

describe("listProviders", () => {
  it("returns sorted provider list", async () => {
    mockBothAPIs();
    const { listProviders } = await import("../functions/provider");

    const result = await listProviders();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].model_count).toBeGreaterThanOrEqual(result[result.length - 1].model_count);
  });
});
