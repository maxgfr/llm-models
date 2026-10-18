// Capability resolution: the Claude table pinned to Anthropic's documentation wins; other models
// follow their catalog entry, with conservative defaults for what it does not say.
import { describe, expect, it } from "bun:test";
import type { SlimModel } from "llm-models/catalog";
import {
  type Capabilities,
  type CatalogModelInfo,
  KNOWN_ANTHROPIC_MODELS,
  resolveCapabilities,
} from "../capabilities.js";

const anthropic = (modelId: string): Capabilities =>
  resolveCapabilities({ kind: "anthropic", modelId });

describe("Claude Opus 5.5", () => {
  const c = anthropic("claude-opus-5-5");

  it("effort low to max, default medium, summarized thinking", () => {
    expect(c.reasoning).toBe(true);
    expect([...c.effort.levels]).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(c.effort.default).toBe("medium");
    expect(c.thinkingDisplay).toBe("summarized");
  });

  it("no sampling, no prefill, no forced tool choice", () => {
    expect([...c.sampling]).toEqual([]);
    expect(c.prefill).toBe(false);
    expect(c.forcedToolChoice).toBe(false);
  });

  it("mid-conversation system messages, dynamic-filtering web search, default fallback", () => {
    expect(c.midConversationSystem).toBe(true);
    expect(c.toolChanges).toBe(true);
    expect(c.webSearch).toBe("anthropic:web_search_20260209");
    expect(c.refusalFallback).toBe("default");
  });

  it("limits and prices", () => {
    expect(c.contextWindow).toBe(1_000_000);
    expect(c.maxOutput).toBe(128_000);
    expect(c.cost).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect([c.vision, c.pdf, c.tools]).toEqual([true, true, true]);
  });
});

describe("the other pinned Claude models", () => {
  it("Sonnet 5.5 and Haiku 5.5", () => {
    const sonnet = anthropic("claude-sonnet-5-5");
    expect(sonnet.effort.default).toBe("high");
    expect(sonnet.forcedToolChoice).toBe(false);
    expect(sonnet.refusalFallback).toBe("default");
    const haiku = anthropic("claude-haiku-5-5");
    expect(haiku.effort.default).toBe("medium");
    expect(haiku.forcedToolChoice).toBe(true);
    expect(haiku.refusalFallback).toBeNull();
    expect(haiku.webSearch).toBe("anthropic:web_search_20250305");
  });

  it("Opus 4.8 takes mid-conversation system messages, Opus 4.7 does not; neither takes sampling", () => {
    expect(anthropic("claude-opus-4-8").midConversationSystem).toBe(true);
    expect(anthropic("claude-opus-4-7").midConversationSystem).toBe(false);
    expect([...anthropic("claude-opus-4-8").sampling]).toEqual([]);
    expect([...anthropic("claude-opus-4-7").sampling]).toEqual([]);
  });

  it("Claude 4.6 takes sampling but no prefill, and has no xhigh", () => {
    const c = anthropic("claude-sonnet-4-6");
    expect([...c.sampling].sort()).toEqual(["temperature", "topK", "topP"]);
    expect(c.prefill).toBe(false);
    expect([...c.effort.levels]).toEqual(["low", "medium", "high", "max"]);
  });

  it("Haiku 4.5 still takes prefill and sampling, with a 200K window", () => {
    const c = anthropic("claude-haiku-4-5");
    expect(c.prefill).toBe(true);
    expect([...c.sampling].sort()).toEqual(["temperature", "topK", "topP"]);
    expect(c.contextWindow).toBe(200_000);
    expect(c.maxOutput).toBe(64_000);
  });

  it("names exact ids, and wins over a catalog that disagrees", () => {
    expect(KNOWN_ANTHROPIC_MODELS.has("claude-opus-5-5")).toBe(true);
    expect(KNOWN_ANTHROPIC_MODELS.has("claude-opus-5-5-20260401")).toBe(false);
    const catalog: CatalogModelInfo = { contextWindow: 200_000 };
    expect(
      resolveCapabilities({ kind: "anthropic", modelId: "claude-opus-5-5", catalog }).contextWindow,
    ).toBe(1_000_000);
  });
});

describe("unknown and catalog models", () => {
  it("an unknown Claude model gets the conservative surface", () => {
    const c = anthropic("claude-future-9");
    expect([...c.sampling]).toEqual([]);
    expect(c.prefill).toBe(false);
    expect(c.forcedToolChoice).toBe(false);
    expect(c.midConversationSystem).toBe(false);
    expect([...c.effort.levels]).toEqual([]);
    expect(c.refusalFallback).toBeNull();
  });

  it("an OpenAI-compatible model follows its catalog entry", () => {
    const c = resolveCapabilities({
      kind: "openai-compatible",
      modelId: "deepseek-reasoner",
      catalog: {
        contextWindow: 128_000,
        maxOutput: 64_000,
        input: ["text"],
        reasoning: true,
        toolCall: true,
        cost: { input: 0.28, output: 0.42 },
      },
    });
    expect(c.reasoning).toBe(true);
    expect(c.thinkingDisplay).toBe("raw");
    expect(c.vision).toBe(false);
    expect(c.tools).toBe(true);
    expect([c.contextWindow, c.maxOutput]).toEqual([128_000, 64_000]);
    expect(c.cost).toEqual({ input: 0.28, output: 0.42 });
    expect([...c.effort.levels]).toEqual([]);
    expect([...c.sampling]).toEqual(["temperature", "topP"]);
  });

  it("reads a slim catalog entry", () => {
    const slim: SlimModel = { id: "gpt-5", name: "GPT-5", tool_call: true, reasoning: true };
    const c = resolveCapabilities({ kind: "openai", modelId: "gpt-5", catalog: slim });
    expect(c.tools).toBe(true);
    expect(c.reasoning).toBe(true);
    expect(c.thinkingDisplay).toBe("summarized");
    expect([...c.effort.levels]).toEqual(["minimal", "low", "medium", "high"]);
    expect(c.effort.default).toBe("medium");
    // OpenAI's reasoning models refuse sampling parameters
    expect([...c.sampling]).toEqual([]);
    expect(c.forcedToolChoice).toBe(true);
    expect(c.webSearch).toBe("openai:web_search");
  });

  it("a catalog that says the model does not reason wins over the effort table", () => {
    const c = resolveCapabilities({
      kind: "openai",
      modelId: "gpt-5",
      catalog: { reasoning: false },
    });
    expect([...c.effort.levels]).toEqual([]);
    expect(c.reasoning).toBe(false);
  });

  it("image and PDF input in the catalog", () => {
    const c = resolveCapabilities({
      kind: "google",
      modelId: "gemini-3-flash",
      catalog: { input: ["text", "image", "pdf"], toolCall: true },
    });
    expect([c.vision, c.pdf]).toEqual([true, true]);
    expect(c.webSearch).toBe("google:google_search");
  });

  it("without a catalog entry nothing optional is assumed", () => {
    const c = resolveCapabilities({ kind: "openai-compatible", modelId: "my-local-model" });
    expect([c.vision, c.pdf, c.reasoning, c.tools]).toEqual([false, false, false, false]);
    expect(c.thinkingDisplay).toBeNull();
    expect(c.webSearch).toBeNull();
    expect(c.cost).toBeNull();
    expect(c.contextWindow).toBeGreaterThan(0);
    expect(c.maxOutput).toBeGreaterThan(0);
  });

  it("a user override is applied last", () => {
    const c = resolveCapabilities({
      kind: "openai-compatible",
      modelId: "my-local-model",
      override: { vision: true, contextWindow: 65_536 },
    });
    expect(c.vision).toBe(true);
    expect(c.contextWindow).toBe(65_536);
  });
});
