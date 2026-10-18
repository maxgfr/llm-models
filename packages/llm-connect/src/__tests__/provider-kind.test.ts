import { describe, expect, it } from "bun:test";
import {
  anthropicBaseUrl,
  baseUrlOf,
  isAnthropicHost,
  modelIdOf,
  providerKindOf,
} from "../provider-kind.js";

describe("providerKindOf", () => {
  it("names the protocol the settings call", () => {
    expect(providerKindOf({ apiKey: "k", model: "m" })).toBe("openai");
    expect(
      providerKindOf({ apiKey: "k", model: "m", providerApi: "https://api.openai.com/v1/" }),
    ).toBe("openai");
    expect(providerKindOf({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/anthropic" })).toBe(
      "anthropic",
    );
    expect(providerKindOf({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/google" })).toBe(
      "google",
    );
    expect(providerKindOf({ apiKey: "k", model: "m", providerNpm: "my-llm" })).toBe("my-llm");
  });

  it("calls Chat Completions everything OpenAI-shaped off the official URL", () => {
    expect(
      providerKindOf({ apiKey: "", model: "", customEndpoint: "http://localhost:11434/v1" }),
    ).toBe("openai-compatible");
    expect(
      providerKindOf({
        apiKey: "k",
        model: "m",
        providerNpm: "@ai-sdk/openai",
        providerApi: "https://api.example.org/v1",
      }),
    ).toBe("openai-compatible");
    expect(
      providerKindOf({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/openai-compatible" }),
    ).toBe("openai-compatible");
  });
});

describe("modelIdOf and baseUrlOf", () => {
  it("read the custom endpoint first, then the provider, then its default", () => {
    const custom = {
      apiKey: "",
      model: "gpt-5",
      customEndpoint: "http://localhost:1234/v1/",
      customModel: "qwen3",
    };
    expect([modelIdOf(custom), baseUrlOf(custom)]).toEqual(["qwen3", "http://localhost:1234/v1"]);
    const claude = { apiKey: "k", model: "claude-opus-5-5", providerNpm: "@ai-sdk/anthropic" };
    expect([modelIdOf(claude), baseUrlOf(claude)]).toEqual([
      "claude-opus-5-5",
      "https://api.anthropic.com/v1",
    ]);
    expect(baseUrlOf({ apiKey: "k", model: "m", providerNpm: "@ai-sdk/openai-compatible" })).toBe(
      undefined,
    );
  });

  it("isAnthropicHost matches Anthropic's own API host only", () => {
    expect(isAnthropicHost("https://api.anthropic.com/v1")).toBe(true);
    expect(isAnthropicHost("https://api.anthropic.com.example.org/v1")).toBe(false);
    expect(isAnthropicHost("https://api.minimax.io/anthropic/v1")).toBe(false);
    expect(isAnthropicHost("not a url")).toBe(false);
    expect(isAnthropicHost(undefined)).toBe(false);
  });
});

describe("anthropicBaseUrl", () => {
  it("adds the /v1 Anthropic's own clients add, and keeps a versioned URL", () => {
    expect(anthropicBaseUrl("https://api.z.ai/api/anthropic")).toBe(
      "https://api.z.ai/api/anthropic/v1",
    );
    expect(anthropicBaseUrl("https://api.z.ai/api/anthropic/v1/")).toBe(
      "https://api.z.ai/api/anthropic/v1",
    );
    expect(anthropicBaseUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1");
    expect(anthropicBaseUrl("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1");
  });
});
