import { beforeEach, describe, expect, it } from "bun:test";
import type { SlimCatalog } from "llm-models/catalog";
import { CALLABLE_NPM } from "llm-models/catalog";
import { clearCatalogCache, liveCatalog } from "../catalog-client.js";

const live: SlimCatalog = {
  openai: { id: "openai", name: "OpenAI", npm: "@ai-sdk/openai", models: {} },
};
const fallback: SlimCatalog = {
  anthropic: { id: "anthropic", name: "Anthropic", npm: "@ai-sdk/anthropic", models: {} },
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
    expect(calls).toEqual([{ npm: CALLABLE_NPM }]);
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
