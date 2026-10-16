import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { setCacheEnabled } from "../cache";
import { QueryBuilder, query } from "../functions/query";

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
      id: "google/gemini-2.0-flash",
      canonical_slug: "google/gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      description: "Test",
      created: 1700000000,
      context_length: 1048576,
      supported_parameters: [],
      architecture: {
        modality: "text->text",
        input_modalities: ["text", "image", "audio"],
        output_modalities: ["text"],
        tokenizer: "Gemini",
      },
      pricing: { prompt: "0.0000001", completion: "0.0000004" },
      top_provider: { context_length: 1048576, max_completion_tokens: 65536, is_moderated: false },
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
        family: "gpt",
        cost: { input: 2.5, output: 10 },
      },
    },
  },
  google: {
    id: "google",
    name: "Google",
    doc: "https://ai.google.dev/docs",
    env: ["GOOGLE_API_KEY"],
    npm: "@ai-sdk/google",
    models: {
      "gemini-2.0-flash": {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        attachment: false,
        reasoning: true,
        tool_call: true,
        open_weights: false,
        release_date: "2024-12-01",
        last_updated: "2024-12-01",
        modalities: { input: ["text", "image", "audio"], output: ["text"] },
        limit: { context: 1048576, output: 65536 },
        family: "gemini",
        cost: { input: 0.1, output: 0.4 },
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

describe("query() factory", () => {
  it("returns a QueryBuilder instance", () => {
    const builder = query();
    expect(builder).toBeInstanceOf(QueryBuilder);
  });
});

describe("QueryBuilder", () => {
  it("supports method chaining", () => {
    const builder = query()
      .provider("openai")
      .capability("reasoning")
      .modality("text")
      .maxCost(5)
      .maxCostOutput(20)
      .minContext(100000)
      .search("gpt")
      .status("active")
      .family("gpt")
      .sortBy("cost_input")
      .limit(10);

    expect(builder).toBeInstanceOf(QueryBuilder);
  });

  it("executes with provider filter", async () => {
    mockFetch();
    const models = await query().provider("openai").execute();
    expect(models.length).toBeGreaterThanOrEqual(1);
    for (const m of models) {
      expect(m.provider).toBe("openai");
    }
  });

  it("executes with capability filter", async () => {
    mockFetch();
    const models = await query().capability("reasoning").execute();
    for (const m of models) {
      expect(m.capabilities.reasoning).toBe(true);
    }
  });

  it("executes with sort and limit", async () => {
    mockFetch();
    const models = await query().sortBy("cost_input").limit(1).execute();
    expect(models.length).toBeLessThanOrEqual(1);
  });

  it("executes with family filter", async () => {
    mockFetch();
    const models = await query().family("gpt").execute();
    for (const m of models) {
      expect(m.family?.toLowerCase()).toBe("gpt");
    }
  });

  it("executes with min context", async () => {
    mockFetch();
    const models = await query().minContext(500000).execute();
    for (const m of models) {
      expect(m.context_length).toBeGreaterThanOrEqual(500000);
    }
  });

  it("executes with descending sort", async () => {
    mockFetch();
    const models = await query().sortBy("context_length", true).limit(2).execute();
    if (models.length >= 2) {
      expect(models[0].context_length).toBeGreaterThanOrEqual(models[1].context_length);
    }
  });
});
