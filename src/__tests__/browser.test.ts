import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { setCacheEnabled } from "../cache";
import {
  DEFAULT_BASE_URLS,
  probeBrowserSupport,
  probeBrowserSupportAll,
  providerBaseUrl,
} from "../functions/browser";

beforeAll(() => {
  setCacheEnabled(false);
});

const ORIGIN = "https://app.example.org";
const NOW = () => new Date("2026-10-14T12:00:00.000Z");

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * A fetch that answers OPTIONS with `preflight` and GET with `get`, and records
 * every request so tests can check what the probe sent.
 */
function fakeFetch(
  preflight: { status?: number; headers?: Record<string, string> } | Error,
  get: { status?: number; headers?: Record<string, string> } | Error = { status: 401 },
) {
  const calls: Call[] = [];
  const fn = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    calls.push({ url: String(input), method, headers });
    const answer = method === "OPTIONS" ? preflight : get;
    if (answer instanceof Error) throw answer;
    return new Response(null, { status: answer.status ?? 200, headers: answer.headers });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const OPEN = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Authorization, Content-Type",
};

describe("providerBaseUrl", () => {
  it("prefers the provider's documented api", () => {
    expect(providerBaseUrl({ id: "openai", api: "https://proxy.example/v1" })).toBe(
      "https://proxy.example/v1",
    );
  });

  it("falls back to the known default when models.dev has no api", () => {
    expect(providerBaseUrl({ id: "openai" })).toBe("https://api.openai.com/v1");
    expect(providerBaseUrl({ id: "anthropic", api: null })).toBe("https://api.anthropic.com/v1");
    expect(providerBaseUrl("google")).toBe(DEFAULT_BASE_URLS.google);
  });

  it("returns null when nothing is known", () => {
    expect(providerBaseUrl({ id: "nobody" })).toBeNull();
  });
});

describe("probeBrowserSupport", () => {
  it("sends the preflight a browser would send for an authenticated JSON POST", async () => {
    const { fetch, calls } = fakeFetch({ status: 204, headers: OPEN });
    await probeBrowserSupport(
      { id: "acme", api: "https://api.acme.test/v1/" },
      { origin: ORIGIN, fetch },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("OPTIONS");
    expect(calls[0].url).toBe("https://api.acme.test/v1/chat/completions");
    expect(calls[0].headers.origin).toBe(ORIGIN);
    expect(calls[0].headers["access-control-request-method"]).toBe("POST");
    expect(calls[0].headers["access-control-request-headers"]).toBe("authorization,content-type");
  });

  it("is callable when the preflight allows the origin and every header", async () => {
    const { fetch } = fakeFetch({ status: 204, headers: OPEN });
    const support = await probeBrowserSupport("openai", { origin: ORIGIN, fetch, now: NOW });
    expect(support).toEqual({
      callable: true,
      origin: ORIGIN,
      url: "https://api.openai.com/v1/chat/completions",
      evidence: "preflight",
      checked_at: "2026-10-14T12:00:00.000Z",
    });
  });

  it("accepts an echoed origin and a wildcard header list", async () => {
    const { fetch } = fakeFetch({
      headers: { "access-control-allow-origin": ORIGIN, "access-control-allow-headers": "*" },
    });
    expect((await probeBrowserSupport("xai", { origin: ORIGIN, fetch })).callable).toBe(true);
  });

  it("refuses another origin, then records what a simple GET shows", async () => {
    const { fetch, calls } = fakeFetch(
      {
        headers: {
          "access-control-allow-origin": "https://someone-else.example",
          "access-control-allow-headers": "authorization,content-type",
        },
      },
      { status: 401, headers: { "access-control-allow-origin": "*" } },
    );
    const support = await probeBrowserSupport("openai", { origin: ORIGIN, fetch });
    expect(support.callable).toBe(false);
    expect(support.evidence).toBe("get");
    expect(support.reason).toContain("Access-Control-Allow-Origin is https://someone-else.example");
    expect(support.reason).toContain("CORS is set up but not for this call");
    expect(calls[1]).toMatchObject({ method: "GET", url: "https://api.openai.com/v1/models" });
    expect(calls[1].headers.authorization).toBeUndefined();
  });

  it("refuses a preflight that does not allow the Authorization header", async () => {
    const { fetch } = fakeFetch({
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
      },
    });
    const support = await probeBrowserSupport("openai", { origin: ORIGIN, fetch });
    expect(support.callable).toBe(false);
    expect(support.reason).toContain("Access-Control-Allow-Headers lacks authorization");
    expect(support.reason).toContain("sends no CORS headers either");
  });

  it("refuses a non-2xx preflight even when it carries CORS headers", async () => {
    const { fetch } = fakeFetch({ status: 405, headers: OPEN });
    const support = await probeBrowserSupport("openai", { origin: ORIGIN, fetch });
    expect(support.callable).toBe(false);
    expect(support.reason).toContain("status 405");
  });

  it("probes Anthropic's messages endpoint with its headers and reports the required one", async () => {
    const { fetch, calls } = fakeFetch({
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key",
      },
    });
    const support = await probeBrowserSupport(
      { id: "anthropic", npm: "@ai-sdk/anthropic" },
      { origin: ORIGIN, fetch },
    );
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["access-control-request-headers"]).toBe(
      "anthropic-dangerous-direct-browser-access,anthropic-version,content-type,x-api-key",
    );
    expect(support.callable).toBe(true);
    expect(support.required_headers).toEqual({
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("probes Gemini's generateContent with the API-key header", async () => {
    const { fetch, calls } = fakeFetch({
      headers: {
        "access-control-allow-origin": ORIGIN,
        "access-control-allow-headers": "content-type,x-goog-api-key",
      },
    });
    const support = await probeBrowserSupport(
      { id: "google", npm: "@ai-sdk/google" },
      { origin: ORIGIN, fetch },
    );
    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(calls[0].headers["access-control-request-headers"]).toBe("content-type,x-goog-api-key");
    expect(support.callable).toBe(true);
  });

  it("speaks Anthropic's protocol to any provider built on its SDK", async () => {
    const { fetch, calls } = fakeFetch({ headers: OPEN });
    const support = await probeBrowserSupport(
      { id: "minimax", api: "https://api.minimax.io/anthropic/v1", npm: "@ai-sdk/anthropic" },
      { origin: ORIGIN, fetch },
    );
    expect(calls[0].url).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(support.callable).toBe(false);
    expect(support.reason).toContain("lacks anthropic-version, x-api-key");
    expect(support.required_headers).toBeUndefined();
  });

  it("makes no request without a base URL, or with a per-account one", async () => {
    const { fetch, calls } = fakeFetch({ headers: OPEN });
    const unknown = await probeBrowserSupport({ id: "nobody" }, { fetch });
    expect(unknown).toMatchObject({
      callable: false,
      evidence: "none",
      reason: "no known base URL",
    });
    const templated = await probeBrowserSupport(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: models.dev's literal placeholder
      { id: "neon", api: "${NEON_AI_GATEWAY_BASE_URL}/v1" },
      { fetch },
    );
    expect(templated).toMatchObject({ callable: false, evidence: "none" });
    expect(templated.reason).toContain("depends on the account");
    expect(calls).toHaveLength(0);
  });

  it("reports a network failure as not callable, without evidence", async () => {
    const { fetch } = fakeFetch(new TypeError("fetch failed"));
    const support = await probeBrowserSupport("openai", { fetch });
    expect(support).toMatchObject({
      callable: false,
      evidence: "none",
      reason: "preflight failed: fetch failed",
      origin: "https://example.com",
    });
  });
});

describe("probeBrowserSupportAll", () => {
  it("keys every verdict by provider id", async () => {
    const { fetch } = fakeFetch({ headers: OPEN });
    const all = await probeBrowserSupportAll([{ id: "openai" }, { id: "groq" }, { id: "nobody" }], {
      fetch,
      concurrency: 2,
    });
    expect(Object.keys(all).sort()).toEqual(["groq", "nobody", "openai"]);
    expect(all.openai.callable).toBe(true);
    expect(all.nobody.callable).toBe(false);
  });
});

describe("listProviders / getProvider with browser", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const modelsDev = {
    openai: {
      id: "openai",
      name: "OpenAI",
      doc: "https://platform.openai.com/docs",
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
          last_updated: "2024-05-13",
          modalities: { input: ["text"], output: ["text"] },
          limit: { context: 128000, output: 16384 },
          cost: { input: 2.5, output: 10 },
        },
      },
    },
  };

  const openRouter = {
    data: [
      {
        id: "openai/gpt-4o",
        canonical_slug: "openai/gpt-4o",
        name: "GPT-4o",
        description: "Test",
        created: 1715558400,
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

  function mockApis() {
    globalThis.fetch = mock((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.includes("openrouter") ? openRouter : modelsDev)),
      ),
    ) as unknown as typeof fetch;
  }

  it("leaves `browser` out unless asked", async () => {
    mockApis();
    const { listProviders } = await import("../functions/provider");
    const [openai] = await listProviders();
    expect(openai.browser).toBeUndefined();
  });

  it("attaches each provider's verdict, probed with the injected fetch", async () => {
    mockApis();
    const { fetch, calls } = fakeFetch({ headers: OPEN });
    const { listProviders, getProvider } = await import("../functions/provider");

    const [openai] = await listProviders({ browser: { origin: ORIGIN, fetch } });
    expect(openai.browser).toMatchObject({ callable: true, origin: ORIGIN });
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");

    const one = await getProvider("OPENAI", { browser: { origin: ORIGIN, fetch } });
    expect(one.browser?.callable).toBe(true);
  });
});

// Opt-in: hits the real provider APIs (no API key involved).
//   LLM_MODELS_LIVE_PROBE=1 bun test src/__tests__/browser.test.ts
describe.skipIf(!process.env.LLM_MODELS_LIVE_PROBE)("live browser probe", () => {
  it("finds OpenAI callable from a page", async () => {
    const support = await probeBrowserSupport({ id: "openai", npm: "@ai-sdk/openai" });
    expect(support).toMatchObject({ callable: true, evidence: "preflight" });
  }, 20_000);

  it("finds Anthropic callable with its browser-access header", async () => {
    const support = await probeBrowserSupport({ id: "anthropic", npm: "@ai-sdk/anthropic" });
    expect(support).toMatchObject({
      callable: true,
      required_headers: { "anthropic-dangerous-direct-browser-access": "true" },
    });
  }, 20_000);
});
