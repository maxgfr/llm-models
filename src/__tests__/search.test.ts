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
    family: "gpt",
    status: "active",
    knowledge_cutoff: "2024-06",
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
    family: "claude",
    knowledge_cutoff: "2025-03",
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
    family: "gemini",
    knowledge_cutoff: "2025-01",
    sources: { openrouter: true, models_dev: true },
  },
  {
    id: "meta/llama-3-70b",
    name: "Llama 3 70B",
    provider: "meta",
    context_length: 8192,
    modalities: { input: ["text"], output: ["text"] },
    capabilities: { open_weights: true },
    status: "deprecated",
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

  it("filters by maxCostOutput", () => {
    const result = filterModels(mockModels, { maxCostOutput: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("google/gemini-2.0-flash");
  });

  it("filters by status active (includes undefined)", () => {
    const result = filterModels(mockModels, { status: "active" });
    // active + undefined status models (excludes deprecated meta/llama)
    expect(result.every((m) => m.status !== "deprecated")).toBe(true);
    expect(result.length).toBe(3);
  });

  it("filters by status deprecated", () => {
    const result = filterModels(mockModels, { status: "deprecated" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("meta/llama-3-70b");
  });

  it("filters by family", () => {
    const result = filterModels(mockModels, { family: "gpt" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openai/gpt-4o");
  });

  it("filters by family case-insensitive", () => {
    const result = filterModels(mockModels, { family: "GPT" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openai/gpt-4o");
  });

  it("excludes models without cost when maxCostOutput set", () => {
    const result = filterModels(mockModels, { maxCostOutput: 100 });
    // meta/llama has no cost, should be excluded
    expect(result.every((m) => m.cost != null)).toBe(true);
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

  it("sorts by release_date", () => {
    const result = sortModels(mockModels, "release_date");
    // Only gemini has release_date, others should be last
    const withDates = result.filter((m) => m.release_date);
    expect(withDates[0].id).toBe("google/gemini-2.0-flash");
  });

  it("sorts by knowledge_cutoff", () => {
    const result = sortModels(mockModels, "knowledge_cutoff");
    // Should sort alphabetically: 2024-06, 2025-01, 2025-03, null last
    const withKC = result.filter((m) => m.knowledge_cutoff);
    expect(withKC[0].knowledge_cutoff).toBe("2024-06");
    expect(withKC[withKC.length - 1].knowledge_cutoff).toBe("2025-03");
  });

  it("sorts by value (cost-effectiveness)", () => {
    const result = sortModels(mockModels, "value");
    // value = context_length / (input_cost + output_cost)
    // gemini: 1048576 / 0.5 = 2097152
    // openai: 128000 / 12.5 = 10240
    // anthropic: 200000 / 18 = 11111
    // meta: no cost → null → last
    // Ascending: openai (10240) < anthropic (11111) < gemini (2097152) < meta (null)
    expect(result[0].id).toBe("openai/gpt-4o");
    expect(result[result.length - 1].id).toBe("meta/llama-3-70b");
  });

  it("sorts by value descending", () => {
    const result = sortModels(mockModels, "value", true);
    // Descending reverses entire array: null first, then highest value
    // Non-null models should be in descending value order
    const withValue = result.filter((m) => m.cost != null);
    expect(withValue[0].id).toBe("google/gemini-2.0-flash");
    expect(withValue[withValue.length - 1].id).toBe("openai/gpt-4o");
  });
});
