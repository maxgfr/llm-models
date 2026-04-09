import { describe, expect, it } from "bun:test";
import { filterModels, sortModels } from "../functions/search";
import type { UnifiedModel } from "../types";

const mockModels: UnifiedModel[] = [
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    context_length: 128000,
    cost: { input: 2.5, output: 10 },
    modalities: { input: ["text", "image"], output: ["text"] },
    capabilities: { reasoning: false, tool_call: true, structured_output: true },
    sources: { openrouter: true, models_dev: true },
  },
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    context_length: 200000,
    cost: { input: 3, output: 15 },
    modalities: { input: ["text", "image"], output: ["text"] },
    capabilities: { reasoning: true, tool_call: true },
    sources: { openrouter: true, models_dev: true },
  },
  {
    id: "google/gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "google",
    context_length: 1048576,
    cost: { input: 0.1, output: 0.4 },
    modalities: { input: ["text", "image", "audio"], output: ["text"] },
    capabilities: { reasoning: true, tool_call: true, open_weights: false },
    release_date: "2025-01-15",
    sources: { openrouter: true, models_dev: true },
  },
  {
    id: "meta/llama-3-70b",
    name: "Llama 3 70B",
    provider: "meta",
    context_length: 8192,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: { open_weights: true },
    sources: { openrouter: true, models_dev: false },
  },
];

describe("filterModels", () => {
  it("filters by provider", () => {
    const result = filterModels(mockModels, { provider: "openai" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openai/gpt-4o");
  });

  it("filters by capability", () => {
    const result = filterModels(mockModels, { capability: "reasoning" });
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.provider)).toEqual(["anthropic", "google"]);
  });

  it("filters by modality", () => {
    const result = filterModels(mockModels, { modality: "audio" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("google/gemini-2.0-flash");
  });

  it("filters by maxCostInput", () => {
    const result = filterModels(mockModels, { maxCostInput: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("google/gemini-2.0-flash");
  });

  it("filters by minContext", () => {
    const result = filterModels(mockModels, { minContext: 200000 });
    expect(result).toHaveLength(2);
  });

  it("filters by search term", () => {
    const result = filterModels(mockModels, { search: "claude" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("anthropic/claude-sonnet-4");
  });

  it("combines multiple filters", () => {
    const result = filterModels(mockModels, { capability: "tool_call", maxCostInput: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("google/gemini-2.0-flash");
  });
});

describe("sortModels", () => {
  it("sorts by cost_input ascending", () => {
    const result = sortModels(mockModels, "cost_input");
    expect(result[0].id).toBe("google/gemini-2.0-flash");
    // meta/llama has no cost, should be last
    expect(result[result.length - 1].id).toBe("meta/llama-3-70b");
  });

  it("sorts by context_length descending", () => {
    const result = sortModels(mockModels, "context_length", true);
    expect(result[0].id).toBe("google/gemini-2.0-flash");
    expect(result[result.length - 1].id).toBe("meta/llama-3-70b");
  });

  it("sorts by name ascending", () => {
    const result = sortModels(mockModels, "name");
    expect(result[0].name).toBe("Claude Sonnet 4");
  });

  it("puts null costs last", () => {
    const result = sortModels(mockModels, "cost_input");
    const lastModel = result[result.length - 1];
    expect(lastModel.cost).toBeUndefined();
  });
});
