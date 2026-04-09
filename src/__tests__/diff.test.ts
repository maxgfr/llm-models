import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { setCacheEnabled, writeCache } from "../cache";

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
        attachment: false,
        reasoning: false,
        tool_call: true,
        open_weights: false,
        release_date: "2024-05-13",
        last_updated: "2024-11-20",
        modalities: { input: ["text"], output: ["text"] },
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

describe("diffModels", () => {
  it("returns all models as added when no previous snapshot", async () => {
    mockFetch();
    // Ensure no unified snapshot exists by writing an invalid key
    setCacheEnabled(true);
    // Clear unified cache by writing empty
    const { existsSync, rmSync } = require("node:fs");
    const { join } = require("node:path");
    const { homedir } = require("node:os");
    const path = join(homedir(), ".cache", "llm-models", "unified.json");
    if (existsSync(path)) rmSync(path);
    setCacheEnabled(false);

    const { diffModels } = await import("../functions/diff");
    const diff = await diffModels();

    expect(diff.timestamp_previous).toBeNull();
    expect(diff.total_before).toBe(0);
    expect(diff.total_after).toBeGreaterThan(0);
    expect(diff.added.length).toBeGreaterThan(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.price_changes).toHaveLength(0);
  });

  it("detects no changes when snapshot matches current", async () => {
    mockFetch();

    // First, fetch to get current models
    const { fetchUnifiedModels } = await import("../functions/normalize");
    const current = await fetchUnifiedModels();

    // Write as snapshot
    setCacheEnabled(true);
    writeCache("unified", current);
    setCacheEnabled(false);

    const { diffModels } = await import("../functions/diff");
    const diff = await diffModels();

    expect(diff.timestamp_previous).not.toBeNull();
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.price_changes).toHaveLength(0);
    expect(diff.status_changes).toHaveLength(0);
  });

  it("returns correct structure", async () => {
    mockFetch();
    const { diffModels } = await import("../functions/diff");
    const diff = await diffModels();

    expect(typeof diff.timestamp_current).toBe("number");
    expect(diff.timestamp_current).toBeGreaterThan(0);
    expect(Array.isArray(diff.added)).toBe(true);
    expect(Array.isArray(diff.removed)).toBe(true);
    expect(Array.isArray(diff.price_changes)).toBe(true);
    expect(Array.isArray(diff.status_changes)).toBe(true);
    expect(typeof diff.total_before).toBe("number");
    expect(typeof diff.total_after).toBe("number");
  });
});
