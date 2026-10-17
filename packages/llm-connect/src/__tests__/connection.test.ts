import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { anySignal, listEndpointModels, testConnection } from "../connection.js";
import { clearProviders, registerProvider } from "../registry.js";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

interface Call {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal | null;
}

let calls: Call[] = [];

/** A fetch that records each call and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      signal: init?.signal,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Never answers, until the request's signal aborts. */
const hang = (call: Call) =>
  new Promise<Response>((_, reject) => {
    call.signal?.addEventListener("abort", () => reject(call.signal?.reason));
  });

beforeEach(() => {
  calls = [];
  clearProviders();
});

describe("testConnection, models mode", () => {
  it("lists the models of a custom endpoint, with a bearer token only when there is a key", async () => {
    const fetch = fakeFetch(() => json({ data: [{ id: "llama3.2" }, { id: "qwen3" }] }));
    const result = await testConnection(
      { apiKey: "", model: "", customEndpoint: "http://localhost:11434/v1/" },
      { fetch },
    );
    expect(result).toEqual({ ok: true, modelCount: 2, models: ["llama3.2", "qwen3"] });
    expect(calls[0].url).toBe("http://localhost:11434/v1/models");
    expect(calls[0].headers.authorization).toBeUndefined();

    await testConnection(
      { apiKey: "lm", model: "", customEndpoint: "http://localhost:1234/v1" },
      { fetch },
    );
    expect(calls[1].headers.authorization).toBe("Bearer lm");
  });

  it("is reachable even when the server answers without a list", async () => {
    const fetch = fakeFetch(() => new Response("ok"));
    expect(await listEndpointModels("http://x/v1", "", { fetch })).toEqual({
      ok: true,
      modelCount: 0,
      models: [],
    });
  });

  it("sends each provider's own auth headers to its API", async () => {
    const fetch = fakeFetch(() => json({ data: [] }));
    const base = { model: "m", apiKey: "key" };
    await testConnection(
      { ...base, providerNpm: "@ai-sdk/anthropic", providerApi: "https://api.anthropic.com/v1" },
      { fetch },
    );
    await testConnection(
      {
        ...base,
        providerNpm: "@ai-sdk/google",
        providerApi: "https://generativelanguage.googleapis.com/v1beta",
      },
      { fetch },
    );
    await testConnection(
      { ...base, providerNpm: "@ai-sdk/mistral", providerApi: "https://api.mistral.ai/v1/" },
      { fetch },
    );
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.anthropic.com/v1/models",
      "https://generativelanguage.googleapis.com/v1beta/models",
      "https://api.mistral.ai/v1/models",
    ]);
    expect(calls[0].headers).toMatchObject({
      "x-api-key": "key",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[1].headers["x-goog-api-key"]).toBe("key");
    expect(calls[1].headers.authorization).toBeUndefined();
    expect(calls[2].headers.authorization).toBe("Bearer key");
  });

  it("classifies a refused key, another status, a blocked request and a missing URL", async () => {
    const settings = { apiKey: "k", model: "m", providerApi: "https://api.openai.com/v1" };
    expect(await testConnection(settings, { fetch: fakeFetch(() => json({}, 401)) })).toEqual({
      ok: false,
      reason: "auth",
      status: 401,
    });
    expect(await testConnection(settings, { fetch: fakeFetch(() => json({}, 403)) })).toMatchObject(
      { reason: "auth" },
    );
    expect(await testConnection(settings, { fetch: fakeFetch(() => json({}, 500)) })).toEqual({
      ok: false,
      reason: "http",
      status: 500,
    });
    const blocked = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await testConnection(settings, { fetch: blocked })).toEqual({
      ok: false,
      reason: "cors",
      message: "Failed to fetch",
    });
    expect(await testConnection({ apiKey: "k", model: "m" }, { fetch: blocked })).toMatchObject({
      ok: false,
      reason: "config",
    });
  });

  it("gives up after the timeout: 5 s for an endpoint, 10 s for a provider by default", async () => {
    expect(
      await testConnection(
        { apiKey: "", model: "", customEndpoint: "http://localhost:11434/v1" },
        { fetch: fakeFetch(hang), timeoutMs: 20 },
      ),
    ).toEqual({ ok: false, reason: "timeout" });

    // The default timeouts, as requested from AbortSignal.timeout
    const requested: number[] = [];
    const timeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms: number) => {
      requested.push(ms);
      return timeout.call(AbortSignal, ms);
    };
    try {
      const fetch = fakeFetch(() => json({ data: [] }));
      await testConnection(
        { apiKey: "", model: "", customEndpoint: "http://localhost:11434/v1" },
        { fetch },
      );
      await testConnection(
        { apiKey: "k", model: "m", providerApi: "https://api.openai.com/v1" },
        { fetch },
      );
    } finally {
      AbortSignal.timeout = timeout;
    }
    expect(requested).toEqual([5000, 10000]);
  });

  it("rethrows the caller's own abort", async () => {
    const controller = new AbortController();
    const pending = testConnection(
      { apiKey: "", model: "", customEndpoint: "http://localhost:11434/v1" },
      { fetch: fakeFetch(hang), signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe("anySignal without AbortSignal.any (Chrome < 116, Safari < 17.4)", () => {
  const any = AbortSignal.any;
  beforeEach(() => {
    (AbortSignal as { any?: unknown }).any = undefined;
  });
  afterEach(() => {
    AbortSignal.any = any;
  });

  it("aborts with the first signal's reason", () => {
    const a = new AbortController();
    const b = new AbortController();
    const signal = anySignal([a.signal, b.signal]);
    expect(signal.aborted).toBe(false);
    b.abort(new Error("second"));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("second");
    expect(anySignal([AbortSignal.abort("done"), a.signal]).reason).toBe("done");
  });

  it("still times out a test the caller can cancel", async () => {
    const controller = new AbortController();
    expect(
      await testConnection(
        { apiKey: "", model: "", customEndpoint: "http://localhost:11434/v1" },
        { fetch: fakeFetch(hang), signal: controller.signal, timeoutMs: 20 },
      ),
    ).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("testConnection, generate mode", () => {
  function useModel(doGenerate: MockLanguageModelV4["doGenerate"]) {
    registerProvider(
      "openai",
      () => new MockLanguageModelV4({ doGenerate }) as unknown as LanguageModel,
    );
  }

  const settings = { apiKey: "k", model: "gpt-5", providerNpm: "@ai-sdk/openai" };

  it("succeeds when the model answers", async () => {
    useModel(async () => ({
      content: [{ type: "text", text: "OK" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }));
    expect(await testConnection(settings, { mode: "generate" })).toEqual({ ok: true });
  });

  it("classifies API errors by status, and network failures as CORS", async () => {
    const { APICallError } = await import("ai");
    const apiError = (statusCode?: number, message = "nope") =>
      new APICallError({
        message,
        url: "https://api.openai.com/v1/responses",
        requestBodyValues: {},
        statusCode,
      });

    useModel(async () => {
      throw apiError(401, "Incorrect API key");
    });
    expect(await testConnection(settings, { mode: "generate" })).toEqual({
      ok: false,
      reason: "auth",
      status: 401,
      message: "Incorrect API key",
    });

    useModel(async () => {
      throw apiError(429, "Rate limited");
    });
    expect(await testConnection(settings, { mode: "generate" })).toMatchObject({
      reason: "http",
      status: 429,
    });

    useModel(async () => {
      throw apiError(undefined, "Cannot connect to API: Failed to fetch");
    });
    expect(await testConnection(settings, { mode: "generate" })).toMatchObject({ reason: "cors" });

    useModel(async () => {
      throw new Error("Model not found in config");
    });
    expect(await testConnection(settings, { mode: "generate" })).toMatchObject({
      reason: "config",
      message: "Model not found in config",
    });
  });

  it("reports a provider that cannot be created", async () => {
    expect(
      await testConnection(
        { apiKey: "k", model: "m", providerNpm: "@ai-sdk/openai-compatible" },
        { mode: "generate" },
      ),
    ).toMatchObject({ ok: false, reason: "config" });
  });
});

afterEach(() => {
  calls = [];
});
