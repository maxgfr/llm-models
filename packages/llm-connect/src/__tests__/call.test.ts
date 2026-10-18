// What a call carries on the wire for each protocol, through the real SDK packages and the
// recorded streams of fixtures/sse: effort, readable reasoning, stateless OpenAI, replay of
// signatures and encrypted reasoning, refusal, the checks made before any call, and errors.
import { beforeEach, describe, expect, it } from "bun:test";
import { type ModelMessage, type StreamTextResult, streamText, type ToolSet } from "ai";
import { callOptions, callProblem, LlmCallError, refusalOf, stopReasonOf } from "../call.js";
import { resolveCapabilities } from "../capabilities.js";
import { describeError } from "../errors.js";
import { loadModel } from "../model.js";
import { clearProviders } from "../registry.js";
import type { LlmSettings } from "../settings.js";
import { type Call, fixtureText, serve, serveFixture } from "./sse.js";

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const KEY = "test-key-not-a-real-secret";

const anthropic = (model: string, providerApi?: string): LlmSettings => ({
  apiKey: KEY,
  model,
  providerNpm: "@ai-sdk/anthropic",
  ...(providerApi ? { providerApi } : {}),
});
const openai = (model: string): LlmSettings => ({
  apiKey: KEY,
  model,
  providerNpm: "@ai-sdk/openai",
  providerApi: "https://api.openai.com/v1",
});
const google = (model: string): LlmSettings => ({
  apiKey: KEY,
  model,
  providerNpm: "@ai-sdk/google",
});

const user = (text: string): ModelMessage => ({ role: "user", content: text });

/** Streams one call to the end, with the settings' call options; the result and the request sent. */
async function run(
  settings: LlmSettings,
  served: Awaited<ReturnType<typeof serveFixture>>,
  input: Parameters<typeof callOptions>[1] = {},
  messages: ModelMessage[] = [user("Hello")],
  extra: Partial<Parameters<typeof streamText>[0]> = {},
) {
  const model = await loadModel(settings, { fetch: served.fetch });
  const errors: unknown[] = [];
  const result = streamText({
    model,
    messages,
    maxRetries: 0,
    ...callOptions(settings, input),
    ...extra,
    onError: ({ error }) => {
      errors.push(error);
    },
  } as Parameters<typeof streamText>[0]) as StreamTextResult<ToolSet, never, never>;
  let text = "";
  let reasoning = "";
  let finish: { finishReason: string; rawFinishReason?: string } | undefined;
  let stepMeta: unknown;
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
    if (part.type === "reasoning-delta") reasoning += part.text;
    if (part.type === "finish-step") stepMeta = part.providerMetadata;
    if (part.type === "finish") finish = part;
    if (part.type === "error") errors.push(part.error);
  }
  const call = served.calls[0] as Call;
  return { result, text, reasoning, finish, stepMeta, errors, call, body: call?.body };
}

beforeEach(() => clearProviders());

describe("Anthropic", () => {
  it("Opus 5.5: explicit effort, summarized adaptive thinking, no sampling, streaming", async () => {
    const served = await serveFixture("anthropic-text.sse");
    const { body, call, text, finish } = await run(anthropic("claude-opus-5-5"), served, {
      effort: "xhigh",
    });
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "xhigh" });
    for (const key of ["temperature", "top_p", "top_k", "tool_choice", "fallbacks"])
      expect(key in body).toBe(false);
    expect(text).toBe("The capital of France is **Paris**.");
    expect(finish && stopReasonOf("anthropic", finish.finishReason, finish.rawFinishReason)).toBe(
      "end",
    );
  });

  it("the refusal fallback is opt-in, and only on Anthropic's own API", async () => {
    const own = await serveFixture("anthropic-text.sse");
    await run(anthropic("claude-opus-5-5"), own, { effort: "low", refusalFallback: true });
    expect(own.calls[0].body.fallbacks).toBe("default");
    expect(own.calls[0].headers["anthropic-beta"]?.split(",")).toContain(
      "server-side-fallback-2026-07-01",
    );
    const proxy = await serveFixture("anthropic-text.sse");
    await run(anthropic("claude-opus-5-5", "https://llm.example.org/v1"), proxy, {
      effort: "low",
      refusalFallback: true,
    });
    expect(proxy.calls[0].url).toBe("https://llm.example.org/v1/messages");
    expect("fallbacks" in proxy.calls[0].body).toBe(false);
    expect("anthropic-dangerous-direct-browser-access" in proxy.calls[0].headers).toBe(false);
    // A model without a server-side fallback gets none
    const haiku = await serveFixture("anthropic-text.sse");
    await run(anthropic("claude-haiku-5-5"), haiku, { effort: "low", refusalFallback: true });
    expect("fallbacks" in haiku.calls[0].body).toBe(false);
  });

  it("a thinking block is replayed byte for byte, with its signature, from response.messages", async () => {
    const first = await serveFixture("anthropic-thinking.sse");
    const settings = anthropic("claude-opus-5-5");
    const turn = await run(settings, first, { effort: "high" }, [user("Is 1009 prime?")]);
    expect(turn.reasoning).toContain("The user asks whether 1009 is prime.");
    const { messages } = await turn.result.response;
    const second = await serveFixture("anthropic-text.sse");
    await run(settings, second, { effort: "high" }, [
      user("Is 1009 prime?"),
      ...messages,
      user("And 1013?"),
    ]);
    const sent = second.calls[0].body.messages as { role: string; content: unknown[] }[];
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const raw = await fixtureText("anthropic-thinking.sse");
    const signature = /"signature":"([^"]+)"/.exec(raw.split("signature_delta")[1] ?? "")?.[1];
    expect(signature).toBeTruthy();
    expect(sent[1].content[0]).toEqual({
      type: "thinking",
      thinking: turn.reasoning,
      signature,
    });
    expect(sent[1].content[1]).toMatchObject({ type: "text", text: turn.text });
  });

  it("Claude 4.6 with a sampling parameter keeps the effort but runs without thinking", async () => {
    const served = await serveFixture("anthropic-text.sse");
    const { body } = await run(anthropic("claude-sonnet-4-6"), served, {
      effort: "high",
      sampling: { temperature: 0.3 },
    });
    expect(body.temperature).toBe(0.3);
    expect(body.output_config).toEqual({ effort: "high" });
    expect("thinking" in body).toBe(false);
  });

  it("Haiku 4.5 takes effort as a thinking budget inside its output limit", async () => {
    const served = await serveFixture("anthropic-text.sse");
    const { body } = await run(anthropic("claude-haiku-4-5"), served, { effort: "medium" });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(body.max_tokens).toBe(64_000);
    expect("output_config" in body).toBe(false);
  });

  it("a refusal is the refusal stop reason, with its category", async () => {
    const served = await serveFixture("anthropic-refusal.sse");
    const { finish, stepMeta, text } = await run(anthropic("claude-opus-5-5"), served, {
      effort: "low",
    });
    expect(text).toBe("Here is how the first stage of the payload");
    expect(finish && stopReasonOf("anthropic", finish.finishReason, finish.rawFinishReason)).toBe(
      "refusal",
    );
    expect(refusalOf(stepMeta)).toEqual({
      category: "cyber",
      explanation: "This request was declined by a safety classifier.",
    });
  });

  it("an error event mid-stream and a refused key are classified, the key never shown", async () => {
    const midStream = await serveFixture("anthropic-error.sse");
    const broken = await run(anthropic("claude-opus-5-5"), midStream);
    expect(broken.text).toBe("Let me walk through");
    expect(describeError(broken.errors[0], KEY)).toMatchObject({
      code: "overloaded",
      retryable: true,
      message: "Overloaded",
    });
    const refused = await serveFixture("anthropic-auth-error.json", 401);
    const auth = await run(anthropic("claude-opus-5-5"), refused);
    const error = describeError(auth.errors[0], KEY);
    expect(error).toEqual({
      code: "auth",
      message: "invalid x-api-key",
      status: 401,
      retryable: false,
    });
  });

  it("an Anthropic-compatible gateway: its URL with or without /v1, its 200 error reported", async () => {
    // Z.ai answers some errors with HTTP 200 and a JSON body instead of an event stream
    const served = serve('{"code":500,"msg":"404 NOT_FOUND"}', 200, "application/json");
    const zai = anthropic("glm-5", "https://api.z.ai/api/anthropic");
    const { call, errors, finish } = await run(zai, served);
    expect(call.url).toBe("https://api.z.ai/api/anthropic/v1/messages");
    expect(finish).toBeUndefined();
    expect(describeError(errors[0], KEY)).toEqual({
      code: "server",
      message: "404 NOT_FOUND",
      status: 500,
      retryable: true,
    });
    const { generateText } = await import("ai");
    const model = await loadModel(zai, { fetch: served.fetch });
    const failure = await generateText({ model, prompt: "Hi", maxRetries: 0 }).catch((e) => e);
    expect(describeError(failure, KEY)).toMatchObject({ code: "server", message: "404 NOT_FOUND" });
  });

  it("a stream cut before its finish event is truncated", async () => {
    const whole = await fixtureText("anthropic-text.sse");
    const served = serve(whole.slice(0, whole.indexOf("event: message_delta")));
    const { finish } = await run(anthropic("claude-opus-5-5"), served);
    expect(finish && stopReasonOf("anthropic", finish.finishReason, finish.rawFinishReason)).toBe(
      "truncated",
    );
  });

  it("an effort the model does not take is refused before any call", () => {
    expect(() => callOptions(anthropic("claude-opus-5-5"), { effort: "none" })).toThrow(
      LlmCallError,
    );
    expect(() => callOptions(anthropic("claude-future-9"), { effort: "high" })).toThrow(
      "does not take the effort high",
    );
  });
});

describe("OpenAI", () => {
  it("Responses API, stateless, encrypted reasoning and a summary, effort as reasoning.effort", async () => {
    const served = await serveFixture("openai-tool-call.sse");
    const { call, body } = await run(openai("gpt-5"), served, { effort: "minimal" });
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(body.store).toBe(false);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.reasoning).toEqual({ effort: "minimal", summary: "auto" });
  });

  it("a non-reasoning model gets neither reasoning nor include", () => {
    expect(callOptions(openai("gpt-4o"))).toEqual({
      providerOptions: { openai: { store: false } },
    });
  });

  it("the encrypted reasoning comes back and is replayed unchanged", async () => {
    const first = await serveFixture("openai-tool-call.sse");
    const settings = openai("gpt-5.1");
    const { tool, jsonSchema } = await import("ai");
    const calculator = tool({
      description: "Evaluates an arithmetic expression.",
      inputSchema: jsonSchema({
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      }),
    });
    const turn = await run(settings, first, { effort: "low" }, [user("17 × 24?")], {
      tools: { calculator },
    });
    expect(turn.finish?.finishReason).toBe("tool-calls");
    const { messages } = await turn.result.response;
    const second = await serveFixture("openai-tool-call.sse");
    await run(
      settings,
      second,
      { effort: "low" },
      [
        user("17 × 24?"),
        ...messages,
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_Mx4Tq8Wn2Zr6",
              toolName: "calculator",
              output: { type: "text", value: "408" },
            },
          ],
        },
      ],
      { tools: { calculator } },
    );
    const input = second.calls[0].body.input as Record<string, unknown>[];
    const reasoning = input.find((item) => item.type === "reasoning");
    expect(reasoning).toMatchObject({
      id: "rs_0c4e8a2b6d1f3e5a",
      encrypted_content:
        "gAAAAABo8pZ1xW3qR7tY2uI5oP9aS4dF6gH8jK0lZ1xC3vB5nM7qW9eR2tY4uI6oP8aS0dF2gH4jK6lZ8xC0vB2nM4qW6eR8tY0uI2o=",
    });
    expect(second.calls[0].body.store).toBe(false);
  });

  it("the OpenAI SDK on another URL is Chat Completions, sent nothing it may refuse", () => {
    const settings = { ...openai("gpt-5"), providerApi: "https://api.example.org/v1" };
    expect(callOptions(settings)).toEqual({ providerOptions: {} });
    expect(() => callOptions(settings, { effort: "low" })).toThrow(LlmCallError);
  });
});

describe("Gemini", () => {
  it("Gemini 3 takes a thinking level and returns thought summaries, key in a header", async () => {
    const served = await serveFixture("gemini-text.sse");
    const { call, body, finish, text } = await run(google("gemini-3-pro"), served, {
      effort: "high",
    });
    expect(call.url).toContain("gemini-3-pro:streamGenerateContent");
    expect(call.url).not.toContain(KEY);
    expect(call.headers["x-goog-api-key"]).toBe(KEY);
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "high" });
    expect(text).toContain("Soft rain on the roof");
    expect(finish && stopReasonOf("google", finish.finishReason, finish.rawFinishReason)).toBe(
      "end",
    );
  });

  it("Gemini 2.5 takes a thinking budget", () => {
    expect(callOptions(google("gemini-2.5-flash"), { effort: "low" }).providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 } },
    });
  });
});

describe("OpenAI-compatible", () => {
  it("chat completions with the usage chunk requested, and no effort", async () => {
    const settings: LlmSettings = {
      apiKey: KEY,
      model: "llama-3.3-70b-versatile",
      providerNpm: "@ai-sdk/openai-compatible",
      providerApi: "https://api.groq.com/openai/v1",
    };
    const served = await serveFixture("openai-compatible-text.sse");
    const { call, body, text, result } = await run(settings, served);
    expect(call.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(text).toBe("Bonjour means hello.");
    expect((await result.totalUsage).inputTokens).toBe(14);
    expect(callOptions(settings)).toEqual({ providerOptions: {} });
  });
});

describe("strict headers", () => {
  it("only the protocol's own headers leave, never the user-agent or a custom header", async () => {
    const cases: [LlmSettings, string, string[]][] = [
      [
        anthropic("claude-opus-5-5"),
        "anthropic-text.sse",
        [
          "accept",
          "anthropic-beta",
          "anthropic-dangerous-direct-browser-access",
          "anthropic-version",
          "content-type",
          "x-api-key",
        ],
      ],
      [openai("gpt-5"), "openai-tool-call.sse", ["accept", "authorization", "content-type"]],
      [google("gemini-3-flash"), "gemini-text.sse", ["accept", "content-type", "x-goog-api-key"]],
    ];
    for (const [settings, file, allowed] of cases) {
      const served = await serveFixture(file);
      const model = await loadModel(
        { ...settings, headers: { "x-title": "my-app" } },
        { fetch: served.fetch, strictHeaders: true },
      );
      await streamText({ model, prompt: "Hi", maxRetries: 0, onError: () => {} }).consumeStream();
      for (const name of Object.keys(served.calls[0].headers)) expect(allowed).toContain(name);
      expect("user-agent" in served.calls[0].headers).toBe(false);
      expect(served.calls[0].url).not.toContain(KEY);
    }
  });

  it("custom headers still go out by default, without the user-agent", async () => {
    const served = await serveFixture("anthropic-text.sse");
    const model = await loadModel(
      { ...anthropic("claude-opus-5-5"), headers: { "x-title": "my-app" } },
      { fetch: served.fetch },
    );
    await streamText({ model, prompt: "Hi", maxRetries: 0 }).consumeStream();
    expect(served.calls[0].headers["x-title"]).toBe("my-app");
    expect("user-agent" in served.calls[0].headers).toBe(false);
  });
});

describe("callProblem", () => {
  const opus = anthropic("claude-opus-5-5");
  const tools = { search: {} };

  it("refuses what Claude Opus 5.5 does not take", () => {
    const cases: [Parameters<typeof callProblem>[1], string][] = [
      [{ effort: "high", temperature: 0.5 }, "sampling"],
      [{ effort: "none" }, "effort"],
      [{ tools, toolChoice: { type: "tool", toolName: "search" } }, "tool-choice"],
      [{ tools, toolChoice: "required" }, "tool-choice"],
      [{ messages: [user("Hi"), { role: "assistant", content: "Sure" }] }, "prefill"],
      [{ messages: [] }, "no-messages"],
      [{ maxOutputTokens: 200_000 }, "max-output"],
    ];
    for (const [call, code] of cases) expect(callProblem(opus, call)?.code).toBe(code as never);
    expect(
      callProblem(opus, {
        effort: "xhigh",
        tools,
        toolChoice: "auto",
        webSearch: true,
        messages: [user("Hi"), { role: "system", content: "Answer in French." }, user("Go")],
      }),
    ).toBeNull();
  });

  it("a thinking budget refuses sampling; Claude 4.7 refuses a later system message", () => {
    expect(
      callProblem(anthropic("claude-haiku-4-5"), { effort: "low", temperature: 0.2 })?.code,
    ).toBe("budget-sampling");
    expect(callProblem(anthropic("claude-haiku-4-5"), { temperature: 0.2 })).toBeNull();
    expect(
      callProblem(anthropic("claude-opus-4-7"), {
        messages: [user("Hi"), { role: "system", content: "Be terse." }, user("Go")],
      })?.code,
    ).toBe("system-message");
  });

  it("web search, tools, images and PDFs need the model to take them", () => {
    const local: LlmSettings = {
      apiKey: "",
      model: "",
      customEndpoint: "http://localhost:11434/v1",
      customModel: "llama3.2",
    };
    expect(callProblem(local, { webSearch: true })?.code).toBe("web-search");
    expect(callProblem(local, { tools: ["search"] })?.code).toBe("tools");
    const image: ModelMessage = {
      role: "user",
      content: [{ type: "image", image: new Uint8Array([1]), mediaType: "image/png" }],
    };
    const pdf: ModelMessage = {
      role: "user",
      content: [{ type: "file", data: new Uint8Array([1]), mediaType: "application/pdf" }],
    };
    expect(callProblem(local, { messages: [image] })?.code).toBe("vision");
    expect(callProblem(local, { messages: [pdf] })?.code).toBe("pdf");
    expect(callProblem(opus, { messages: [image, pdf] })).toBeNull();
    const caps = resolveCapabilities({
      kind: "google",
      modelId: "gemini-2.5-flash",
      catalog: { toolCall: true },
    });
    expect(
      callProblem(google("gemini-2.5-flash"), { webSearch: true, tools: ["search"] }, caps)?.code,
    ).toBe("web-search");
    expect(callProblem(google("gemini-2.5-flash"), { webSearch: true }, caps)).toBeNull();
  });
});

describe("stopReasonOf", () => {
  it("maps the unified and raw reasons", () => {
    expect(stopReasonOf("anthropic", "stop", "stop_sequence")).toBe("stop-sequence");
    expect(stopReasonOf("anthropic", "other", "pause_turn")).toBe("pause");
    expect(stopReasonOf("openai", "length", "max_output_tokens")).toBe("length");
    expect(stopReasonOf("openai", "content-filter", "content_filter")).toBe("content-filter");
    expect(stopReasonOf("openai", "stop")).toBe("end");
    expect(stopReasonOf("openai", "other", "weird")).toBe("other");
    expect(refusalOf(undefined)).toBeNull();
  });
});
