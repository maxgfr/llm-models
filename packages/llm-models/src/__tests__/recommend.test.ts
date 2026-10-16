import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { setCacheEnabled } from "../cache";
import { listUseCases, recommendModels } from "../functions/recommend";

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
      supported_parameters: [],
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
        structured_output: true,
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

describe("listUseCases", () => {
  it("returns all use case presets", () => {
    const useCases = listUseCases();
    expect(Object.keys(useCases)).toContain("code-gen");
    expect(Object.keys(useCases)).toContain("vision");
    expect(Object.keys(useCases)).toContain("cheap-chatbot");
    expect(Object.keys(useCases)).toContain("reasoning");
    expect(Object.keys(useCases)).toContain("long-context");
    expect(Object.keys(useCases)).toContain("open-source");
    expect(Object.keys(useCases)).toContain("audio");
    expect(Object.keys(useCases)).toContain("tool-use");
  });

  it("each preset has description, filter, and sort", () => {
    const useCases = listUseCases();
    for (const preset of Object.values(useCases)) {
      expect(typeof preset.description).toBe("string");
      expect(preset.description.length).toBeGreaterThan(0);
      expect(typeof preset.filter).toBe("object");
      expect(typeof preset.sort).toBe("string");
    }
  });
});

describe("recommendModels", () => {
  it("returns models for valid use case", async () => {
    mockFetch();
    const result = await recommendModels("vision");
    expect(result.preset).toBeDefined();
    expect(result.preset.description).toContain("Image");
    expect(Array.isArray(result.models)).toBe(true);
  });

  it("returns models for code-gen use case", async () => {
    mockFetch();
    const result = await recommendModels("code-gen");
    expect(result.preset.sort).toBe("cost_input");
    expect(Array.isArray(result.models)).toBe(true);
  });

  it("throws for unknown use case", async () => {
    expect(recommendModels("nonexistent")).rejects.toThrow("Unknown use case");
  });

  it("respects limit option", async () => {
    mockFetch();
    const result = await recommendModels("vision", { limit: 1 });
    expect(result.models.length).toBeLessThanOrEqual(1);
  });

  it("accepts maxCost option", async () => {
    mockFetch();
    const result = await recommendModels("vision", { maxCost: 0.01 });
    for (const m of result.models) {
      if (m.cost) {
        expect(m.cost.input).toBeLessThanOrEqual(0.01);
      }
    }
  });
});
