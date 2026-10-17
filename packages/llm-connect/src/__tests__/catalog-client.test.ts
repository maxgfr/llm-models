import { beforeEach, describe, expect, it } from "bun:test";
import { setCacheEnabled } from "llm-models/browser";
import type { SlimCatalog } from "llm-models/catalog";
import { CALLABLE_NPM } from "llm-models/catalog";
import { clearCatalogCache, liveCatalog } from "../catalog-client.js";
import { FakeCacheStorage } from "./fake-cache-storage.js";

const live: SlimCatalog = {
  openai: { id: "openai", name: "OpenAI", npm: "@ai-sdk/openai", models: {} },
};
const fallback: SlimCatalog = {
  anthropic: { id: "anthropic", name: "Anthropic", npm: "@ai-sdk/anthropic", models: {} },
};

const modelsDevDocument = {
  openai: {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    api: "https://api.openai.com/v1",
    doc: "https://platform.openai.com/docs/models",
    env: ["OPENAI_API_KEY"],
    models: {
      "gpt-5": {
        id: "gpt-5",
        name: "GPT-5",
        attachment: true,
        reasoning: true,
        tool_call: true,
        open_weights: false,
        release_date: "2025-08-07",
        last_updated: "2025-08-07",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 400000, output: 128000 },
      },
    },
  },
};

const openRouterDocument = {
  data: [
    {
      id: "openai/gpt-5",
      canonical_slug: "openai/gpt-5",
      name: "OpenAI: GPT-5",
      description: "GPT-5",
      created: 1754587413,
      context_length: 400000,
      supported_parameters: [],
      architecture: {
        modality: "text+image->text",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        tokenizer: "GPT",
      },
      pricing: { prompt: "0.00000125", completion: "0.00001" },
      top_provider: { context_length: 400000, max_completion_tokens: 128000, is_moderated: true },
      links: { details: "/openai/gpt-5" },
    },
  ],
};

function server() {
  const requests: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify(fallback));
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

beforeEach(() => clearCatalogCache());

describe("liveCatalog", () => {
  it("builds the catalog once for every caller, with the callable SDKs by default", async () => {
    const calls: unknown[] = [];
    const { fetch, requests } = server();
    const load = liveCatalog({
      fallbackUrl: "/models.json",
      fetch,
      build: async (options) => {
        calls.push(options);
        return live;
      },
    });
    expect(await Promise.all([load(), load()])).toEqual([live, live]);
    expect(calls).toEqual([{ npm: CALLABLE_NPM, fetch: expect.any(Function) }]);
    expect(requests).toEqual([]);
  });

  it("falls back to the static catalog when the build fails or comes back empty", async () => {
    for (const build of [
      async () => {
        throw new Error("models.dev unreachable");
      },
      async () => ({}),
    ]) {
      clearCatalogCache();
      const { fetch, requests } = server();
      const load = liveCatalog({ fallbackUrl: "/models.json", fetch, required: ["openai"], build });
      expect(await load()).toEqual(fallback);
      expect(requests).toEqual(["/models.json"]);
    }
  });

  it("builds from the API responses a previous page load kept in Cache Storage", async () => {
    setCacheEnabled(false); // llm-models' in-memory cache would hide the requests
    try {
      const storage = new FakeCacheStorage();
      const requests: string[] = [];
      const fetch = (async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify(
            String(input).includes("openrouter") ? openRouterDocument : modelsDevDocument,
          ),
          { headers: { "content-type": "application/json", etag: '"v1"' } },
        );
      }) as typeof globalThis.fetch;
      const options = { fetch, cacheStorage: storage.asCacheStorage(), npm: ["@ai-sdk/openai"] };

      const first = await liveCatalog(options)();
      expect(Object.keys(first.openai?.models ?? {})).toEqual(["gpt-5"]);
      expect(requests.sort()).toEqual([
        "https://models.dev/api.json",
        "https://openrouter.ai/api/v1/models",
      ]);
      expect(storage.entry("llm-connect-catalog", "https://models.dev/api.json")).toBeDefined();

      // The next page load: a new loader, the same Cache Storage, no request
      expect(await liveCatalog(options)()).toEqual(first);
      expect(requests).toHaveLength(2);

      // cacheName: false keeps nothing across loads
      await liveCatalog({ ...options, cacheName: false })();
      expect(requests).toHaveLength(4);
    } finally {
      setCacheEnabled(true);
    }
  });

  it("forgets a failure, so the next call retries", async () => {
    let attempts = 0;
    const load = liveCatalog({
      build: async () => {
        attempts++;
        if (attempts === 1) throw new Error("offline");
        return live;
      },
    });
    await expect(load()).rejects.toThrow("offline");
    expect(await load()).toEqual(live);
    expect(attempts).toBe(2);
  });
});
