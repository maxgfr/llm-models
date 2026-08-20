import { describe, expect, it } from "bun:test";
import { pickBestModel, providersForEndpoint } from "../functions/resolve";
import type { ModelsDevResponse, UnifiedModel } from "../types";

function model(id: string, provider: string, context = 1000): UnifiedModel {
  return {
    id,
    name: id,
    provider,
    context_length: context,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: {},
    sources: { openrouter: false, models_dev: true },
  };
}

describe("pickBestModel", () => {
  it("prefers an exact id", () => {
    const pool = [model("z-ai/glm-5.3", "z-ai"), model("glm-5.3", "opencode-go")];
    expect(pickBestModel(pool, "glm-5.3")?.id).toBe("glm-5.3");
  });

  it("matches on the trailing segment when no exact id exists", () => {
    const pool = [model("nano-gpt/zai-org/glm-5.3", "nano-gpt"), model("z-ai/glm-5.3", "z-ai")];
    expect(pickBestModel(pool, "glm-5.3")?.id).toBe("z-ai/glm-5.3");
  });

  it("prefers the canonical entry over a reseller at equal rank", () => {
    const pool = [
      model("orcarouter/deepseek/deepseek-chat", "orcarouter"),
      model("deepseek/deepseek-chat", "deepseek"),
    ];
    expect(pickBestModel(pool, "deepseek-chat")?.id).toBe("deepseek/deepseek-chat");
  });

  it("matches case-insensitively", () => {
    const pool = [model("minimax/minimax-m2.7", "minimax")];
    expect(pickBestModel(pool, "MiniMax-M2.7")?.id).toBe("minimax/minimax-m2.7");
  });

  it("is deterministic when ids tie on shape", () => {
    const pool = [model("bbb/glm-5.3", "bbb"), model("aaa/glm-5.3", "aaa")];
    expect(pickBestModel(pool, "glm-5.3")?.id).toBe("aaa/glm-5.3");
  });

  it("returns null when nothing matches", () => {
    expect(pickBestModel([model("openai/gpt-4o", "openai")], "glm-5.3")).toBeNull();
  });
});

const modelsDev = {
  zai: { id: "zai", name: "Z.AI", api: "https://api.z.ai/api/paas/v4", models: {} },
  "zai-coding-plan": {
    id: "zai-coding-plan",
    name: "Z.AI Coding Plan",
    api: "https://api.z.ai/api/coding/paas/v4",
    models: {},
  },
  deepseek: { id: "deepseek", name: "DeepSeek", api: "https://api.deepseek.com", models: {} },
  openai: { id: "openai", name: "OpenAI", api: "https://api.openai.com/v1", models: {} },
  nopeapi: { id: "nopeapi", name: "No API", models: {} },
} as unknown as ModelsDevResponse;

describe("providersForEndpoint", () => {
  it("matches on host, ignoring the path", () => {
    expect(providersForEndpoint("https://api.deepseek.com/anthropic", modelsDev)).toEqual([
      "deepseek",
    ]);
  });

  it("returns every provider on the host, best path overlap first", () => {
    expect(providersForEndpoint("https://api.z.ai/api/coding", modelsDev)).toEqual([
      "zai-coding-plan",
      "zai",
    ]);
  });

  it("falls back to id length when no path segment overlaps", () => {
    expect(providersForEndpoint("https://api.z.ai/anthropic", modelsDev)).toEqual([
      "zai",
      "zai-coding-plan",
    ]);
  });

  it("ignores www and casing", () => {
    expect(providersForEndpoint("https://WWW.API.DEEPSEEK.COM/anthropic", modelsDev)).toEqual([
      "deepseek",
    ]);
  });

  it("accepts a bare host with no scheme", () => {
    expect(providersForEndpoint("api.deepseek.com", modelsDev)).toEqual(["deepseek"]);
  });

  it("returns nothing for an unknown host", () => {
    expect(providersForEndpoint("https://ark.cn-beijing.volces.com/api/coding", modelsDev)).toEqual(
      [],
    );
  });

  it("returns nothing for an unparseable endpoint", () => {
    expect(providersForEndpoint("", modelsDev)).toEqual([]);
  });
});
