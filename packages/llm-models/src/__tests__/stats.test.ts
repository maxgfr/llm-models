import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { setCacheEnabled } from "../cache";

beforeAll(() => {
  setCacheEnabled(false);
});

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
      supported_parameters: ["temperature"],
      architecture: {
        modality: "text->text",
        input_modalities: ["text", "image"],
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

function mockFetch() {
  globalThis.fetch = mock((url: string) => {
    if (url.includes("openrouter")) {
      return Promise.resolve(new Response(JSON.stringify(mockOpenRouterResponse), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(mockModelsDevResponse), { status: 200 }));
  }) as typeof fetch;
}

describe("getStats", () => {
  it("returns aggregate statistics", async () => {
    mockFetch();
    const { getStats } = await import("../functions/stats");
    const stats = await getStats();

    expect(stats.total_models).toBeGreaterThanOrEqual(2);
    expect(stats.total_providers).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(stats.by_provider)).toBe(true);
    expect(stats.by_provider.length).toBeGreaterThanOrEqual(2);
    expect(typeof stats.by_capability).toBe("object");
    expect(typeof stats.by_modality).toBe("object");
  });

  it("returns cost distribution", async () => {
    mockFetch();
    const { getStats } = await import("../functions/stats");
    const stats = await getStats();

    expect(stats.cost).not.toBeNull();
    if (stats.cost) {
      expect(stats.cost.input.min).toBeLessThanOrEqual(stats.cost.input.max);
      expect(stats.cost.input.p25).toBeLessThanOrEqual(stats.cost.input.median);
      expect(stats.cost.input.median).toBeLessThanOrEqual(stats.cost.input.p75);
      expect(stats.cost.output.min).toBeLessThanOrEqual(stats.cost.output.max);
    }
  });

  it("returns context length stats", async () => {
    mockFetch();
    const { getStats } = await import("../functions/stats");
    const stats = await getStats();

    expect(stats.context_length.min).toBeLessThanOrEqual(stats.context_length.max);
    expect(stats.context_length.median).toBeGreaterThanOrEqual(stats.context_length.min);
    expect(stats.context_length.median).toBeLessThanOrEqual(stats.context_length.max);
  });

  it("providers sorted by count descending", async () => {
    mockFetch();
    const { getStats } = await import("../functions/stats");
    const stats = await getStats();

    for (let i = 1; i < stats.by_provider.length; i++) {
      expect(stats.by_provider[i - 1].count).toBeGreaterThanOrEqual(stats.by_provider[i].count);
    }
  });
});
