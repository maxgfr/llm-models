import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { generateText, type LanguageModel } from "ai";
import { createModel, loadModel, providerNameOf } from "../model.js";
import { clearProviders, hasProvider, registerProvider } from "../registry.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// The SDK warns about unknown models
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const realFetch = globalThis.fetch;
let calls: Captured[] = [];

/** Answer every request with `body`, recording what was sent. */
function serve(body: unknown) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const chatCompletion = {
  id: "c",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const anthropicMessage = {
  id: "msg",
  type: "message",
  role: "assistant",
  model: "claude",
  content: [{ type: "text", text: "OK" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

function providerOf(model: LanguageModel): string {
  return (model as { provider: string }).provider;
}

beforeEach(() => clearProviders());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("providerNameOf", () => {
  it("routes custom endpoints and unknown packages to OpenAI's SDK", () => {
    expect(providerNameOf({ apiKey: "", model: "", customEndpoint: "http://x" })).toBe("openai");
    expect(providerNameOf({ apiKey: "k", model: "m" })).toBe("openai");
    expect(providerNameOf({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/anthropic" })).toBe(
      "anthropic",
    );
    expect(
      providerNameOf({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/openai-compatible" }),
    ).toBe("openai-compatible");
  });
});

describe("createModel", () => {
  it("throws when the provider is not registered", () => {
    expect(() => createModel({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/mistral" })).toThrow(
      'Provider "mistral" is not registered',
    );
  });

  it("passes the custom endpoint, its model and headers to the openai factory", () => {
    const seen: unknown[] = [];
    registerProvider("openai", (config) => {
      seen.push(config);
      return "fake" as unknown as LanguageModel;
    });
    createModel({
      apiKey: "",
      model: "gpt-5",
      customEndpoint: "http://localhost:11434/v1",
      customModel: "llama3.2",
      headers: { "x-a": "1" },
    });
    createModel({ apiKey: "sk", model: "gpt-5", providerApi: "https://api.openai.com/v1" });
    expect(seen).toEqual([
      {
        apiKey: "",
        model: "llama3.2",
        baseURL: "http://localhost:11434/v1",
        headers: { "x-a": "1" },
        fetch: expect.any(Function),
      },
      {
        apiKey: "sk",
        model: "gpt-5",
        baseURL: "https://api.openai.com/v1",
        fetch: expect.any(Function),
      },
    ]);
  });
});

describe("loadModel", () => {
  it("imports and registers only the provider it needs", async () => {
    const model = await loadModel({
      apiKey: "k",
      model: "mistral-large",
      providerNpm: "@ai-sdk/mistral",
    });
    expect(providerOf(model)).toBe("mistral.chat");
    expect(hasProvider("mistral")).toBe(true);
    expect(hasProvider("openai")).toBe(false);
  });

  it("keeps a provider the app registered itself", async () => {
    const own = { provider: "mine" } as unknown as LanguageModel;
    registerProvider("google", () => own);
    expect(await loadModel({ apiKey: "k", model: "g", providerNpm: "@ai-sdk/google" })).toBe(own);
  });

  it("calls a custom endpoint with Chat Completions", async () => {
    serve(chatCompletion);
    const model = await loadModel({
      apiKey: "",
      model: "",
      customEndpoint: "http://localhost:11434/v1",
      customModel: "llama3.2",
    });
    await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].body.model).toBe("llama3.2");
  });

  it("uses the Responses API on the official OpenAI URL", async () => {
    const model = await loadModel({
      apiKey: "sk",
      model: "gpt-5",
      providerNpm: "@ai-sdk/openai",
      providerApi: "https://api.openai.com/v1",
    });
    expect(providerOf(model)).toBe("openai.responses");
  });

  it("sends an Anthropic-compatible key to its own URL, without Anthropic's browser header", async () => {
    serve(anthropicMessage);
    const model = await loadModel({
      apiKey: "mm-key",
      model: "MiniMax-M3",
      providerNpm: "@ai-sdk/anthropic",
      providerApi: "https://api.minimax.io/anthropic/v1",
    });
    await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(calls[0].url).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("mm-key");
    // MiniMax's preflight does not allow it: the opt-in is Anthropic's own
    expect(calls[0].headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
  });

  it("sends the browser header to Anthropic's own API", async () => {
    serve(anthropicMessage);
    const model = await loadModel({
      apiKey: "sk-ant",
      model: "claude-opus-5-5",
      providerNpm: "@ai-sdk/anthropic",
    });
    await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("translates json_schema to json_object for the generic SDK", async () => {
    serve({
      ...chatCompletion,
      choices: [
        { ...chatCompletion.choices[0], message: { role: "assistant", content: '{"a":1}' } },
      ],
    });
    const model = await loadModel({
      apiKey: "zk",
      model: "glm-5",
      providerNpm: "@ai-sdk/openai-compatible",
      providerApi: "https://api.z.ai/api/paas/v4",
    });
    const { Output } = await import("ai");
    const { z } = await import("zod");
    await generateText({
      model,
      prompt: "hi",
      maxRetries: 0,
      output: Output.object({ schema: z.object({ a: z.number() }) }),
    });
    expect(calls[0].url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    const messages = calls[0].body.messages as { role: string; content: string }[];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("JSON schema");
  });

  it("refuses a generic provider without a URL", async () => {
    await expect(
      loadModel({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/openai-compatible" }),
    ).rejects.toThrow("no API URL");
  });
});
