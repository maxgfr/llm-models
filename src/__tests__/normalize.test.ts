import { describe, expect, it } from "bun:test";
import {
  normalizeModelsDevModel,
  normalizeOpenRouterModel,
  openRouterPriceToPerMillion,
} from "../functions/normalize";
import type { ModelsDevModel, OpenRouterModel } from "../types";

describe("openRouterPriceToPerMillion", () => {
  it("converts per-token string to per-million number", () => {
    expect(openRouterPriceToPerMillion("0.000003")).toBeCloseTo(3);
    expect(openRouterPriceToPerMillion("0.000015")).toBeCloseTo(15);
    expect(openRouterPriceToPerMillion("0.0000025")).toBeCloseTo(2.5);
  });

  it("handles zero", () => {
    expect(openRouterPriceToPerMillion("0")).toBe(0);
  });
});

describe("normalizeOpenRouterModel", () => {
  const mockModel: OpenRouterModel = {
    id: "openai/gpt-4o",
    canonical_slug: "openai/gpt-4o-2024-08-06",
    name: "GPT-4o",
    description: "Test model",
    created: 1700000000,
    context_length: 128000,
    supported_parameters: ["temperature"],
    architecture: {
      modality: "text+image->text",
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      tokenizer: "GPT",
    },
    pricing: {
      prompt: "0.0000025",
      completion: "0.00001",
    },
    top_provider: {
      context_length: 128000,
      max_completion_tokens: 16384,
      is_moderated: false,
    },
    links: { details: "/api/v1/models/openai/gpt-4o/endpoints" },
  };

  it("extracts provider from ID", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.provider).toBe("openai");
  });

  it("converts pricing to per-million", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.cost?.input).toBeCloseTo(2.5);
    expect(result.cost?.output).toBeCloseTo(10);
  });

  it("maps modalities", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.modalities.input).toEqual(["text", "image"]);
    expect(result.modalities.output).toEqual(["text"]);
  });

  it("sets sources correctly", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.sources).toEqual({ openrouter: true, models_dev: false });
  });

  it("sets output_limit from top_provider", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.output_limit).toBe(16384);
  });

  it("carries description", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.description).toBe("Test model");
  });

  it("carries supported_parameters", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.supported_parameters).toEqual(["temperature"]);
  });

  it("carries tokenizer from architecture", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.tokenizer).toBe("GPT");
  });

  it("carries reasoning cost when present", () => {
    const modelWithReasoning: OpenRouterModel = {
      ...mockModel,
      pricing: {
        ...mockModel.pricing,
        internal_reasoning: "0.000003",
      },
    };
    const result = normalizeOpenRouterModel(modelWithReasoning);
    expect(result.cost?.reasoning).toBeCloseTo(3);
  });

  it("carries cache costs when present", () => {
    const modelWithCache: OpenRouterModel = {
      ...mockModel,
      pricing: {
        ...mockModel.pricing,
        input_cache_read: "0.00000125",
        input_cache_write: "0.0000025",
      },
    };
    const result = normalizeOpenRouterModel(modelWithCache);
    expect(result.cost?.cache_read).toBeCloseTo(1.25);
    expect(result.cost?.cache_write).toBeCloseTo(2.5);
  });
});

describe("normalizeModelsDevModel", () => {
  const mockModel: ModelsDevModel = {
    id: "gpt-4o",
    name: "GPT-4o",
    attachment: true,
    reasoning: false,
    tool_call: true,
    open_weights: false,
    release_date: "2024-05-13",
    last_updated: "2024-11-20",
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 128000, output: 16384 },
    family: "gpt",
    cost: { input: 2.5, output: 10 },
  };

  it("constructs provider/model ID", () => {
    const result = normalizeModelsDevModel(mockModel, "openai");
    expect(result.id).toBe("openai/gpt-4o");
    expect(result.provider).toBe("openai");
  });

  it("maps capabilities", () => {
    const result = normalizeModelsDevModel(mockModel, "openai");
    expect(result.capabilities.reasoning).toBe(false);
    expect(result.capabilities.tool_call).toBe(true);
    expect(result.capabilities.open_weights).toBe(false);
    expect(result.capabilities.attachment).toBe(true);
  });

  it("maps cost directly (already per-million)", () => {
    const result = normalizeModelsDevModel(mockModel, "openai");
    expect(result.cost?.input).toBe(2.5);
    expect(result.cost?.output).toBe(10);
  });

  it("sets sources correctly", () => {
    const result = normalizeModelsDevModel(mockModel, "openai");
    expect(result.sources).toEqual({ openrouter: false, models_dev: true });
  });

  it("maps release_date and family", () => {
    const result = normalizeModelsDevModel(mockModel, "openai");
    expect(result.release_date).toBe("2024-05-13");
    expect(result.family).toBe("gpt");
  });

  it("carries extended costs when present", () => {
    const modelWithExtendedCosts: ModelsDevModel = {
      ...mockModel,
      cost: {
        input: 2.5,
        output: 10,
        cache_read: 1.25,
        cache_write: 2.5,
        reasoning: 7.5,
        input_audio: 40,
        output_audio: 80,
      },
    };
    const result = normalizeModelsDevModel(modelWithExtendedCosts, "openai");
    expect(result.cost?.cache_read).toBe(1.25);
    expect(result.cost?.cache_write).toBe(2.5);
    expect(result.cost?.reasoning).toBe(7.5);
    expect(result.cost?.input_audio).toBe(40);
    expect(result.cost?.output_audio).toBe(80);
  });

  it("handles model without cost", () => {
    const modelNoCost: ModelsDevModel = {
      ...mockModel,
      cost: undefined,
    };
    const result = normalizeModelsDevModel(modelNoCost, "openai");
    expect(result.cost).toBeUndefined();
  });
});
