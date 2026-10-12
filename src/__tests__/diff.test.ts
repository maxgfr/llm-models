import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCacheDir, removeCache, setCacheDir, setCacheEnabled, writeCache } from "../cache";
import { diffModels } from "../functions/diff";
import { fetchUnifiedModels } from "../functions/normalize";

// diff persists its snapshot, so these tests run the cache for real, in a
// throwaway directory.
const realCacheDir = getCacheDir();
const originalFetch = globalThis.fetch;
let dir = "";

beforeAll(() => {
  setCacheEnabled(true);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "llm-models-diff-"));
  setCacheDir(dir);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  setCacheDir(realCacheDir);
  setCacheEnabled(false);
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

/** Serve the fixtures with gpt-4o's input price set to `inputPerMillion`. */
function mockFetch(inputPerMillion = 2.5) {
  // Drop the cached API responses so the next fetch sees this mock.
  removeCache("openrouter");
  removeCache("models-dev");
  const openrouter = structuredClone(mockOpenRouterResponse);
  openrouter.data[0].pricing.prompt = String(inputPerMillion / 1_000_000);
  const modelsDev = structuredClone(mockModelsDevResponse);
  modelsDev.openai.models["gpt-4o"].cost.input = inputPerMillion;
  globalThis.fetch = mock((url: string) => {
    const body = url.includes("openrouter") ? openrouter : modelsDev;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as unknown as typeof fetch;
}

describe("diffModels", () => {
  it("saves a baseline on the first run", async () => {
    mockFetch();
    const diff = await diffModels();

    expect(diff.timestamp_previous).toBeNull();
    expect(diff.total_before).toBe(0);
    expect(diff.total_after).toBeGreaterThan(0);
    expect(diff.added).toHaveLength(diff.total_after);
    expect(diff.removed).toHaveLength(0);
    expect(existsSync(join(dir, "snapshot.json"))).toBe(true);
  });

  it("keeps its baseline when other commands refresh the data", async () => {
    mockFetch();
    const first = await diffModels();

    // Any other command fetching unified data must not reset diff's baseline.
    mockFetch(5);
    await fetchUnifiedModels();

    const second = await diffModels();
    expect(second.timestamp_previous).toBe(first.timestamp_current);
    expect(second.price_changes).toEqual([
      { model_id: "openai/gpt-4o", field: "cost_input", old_value: 2.5, new_value: 5 },
    ]);
  });

  it("compares against the previous diff, not the first one", async () => {
    mockFetch();
    await diffModels();
    mockFetch(5);
    await diffModels();

    const third = await diffModels();
    expect(third.price_changes).toHaveLength(0);
    expect(third.added).toHaveLength(0);
    expect(third.removed).toHaveLength(0);
  });

  it("uses a pre-1.5 unified.json once as the baseline, then drops it", async () => {
    mockFetch();
    const current = await fetchUnifiedModels();
    writeCache("unified", [...current, { ...current[0], id: "openai/gone" }]);

    const diff = await diffModels();
    expect(diff.timestamp_previous).not.toBeNull();
    expect(diff.removed).toEqual(["openai/gone"]);
    expect(existsSync(join(dir, "unified.json"))).toBe(false);
  });

  it("does not persist a snapshot when the cache is disabled", async () => {
    mockFetch();
    setCacheEnabled(false);
    try {
      await diffModels();
    } finally {
      setCacheEnabled(true);
    }
    expect(existsSync(join(dir, "snapshot.json"))).toBe(false);
  });
});
