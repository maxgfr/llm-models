import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { setCacheEnabled } from "../cache";
import {
  fetchUnifiedData,
  looseModelKey,
  mergeModels,
  normalizeModelsDevModel,
  normalizeOpenRouterModel,
  openRouterPriceToPerMillion,
} from "../functions/normalize";
import { pickBestModel } from "../functions/resolve";
import type { ModelsDevModel, OpenRouterModel, UnifiedModel } from "../types";

describe("openRouterPriceToPerMillion", () => {
  it("converts per-token string to per-million number", () => {
    expect(openRouterPriceToPerMillion("0.000003")).toBeCloseTo(3);
    expect(openRouterPriceToPerMillion("0.000015")).toBeCloseTo(15);
    expect(openRouterPriceToPerMillion("0.0000025")).toBeCloseTo(2.5);
  });

  it("returns exact decimals, without floating-point noise", () => {
    expect(openRouterPriceToPerMillion("0.00000005")).toBe(0.05);
    expect(openRouterPriceToPerMillion("0.0000001")).toBe(0.1);
    expect(openRouterPriceToPerMillion("0.00000015")).toBe(0.15);
  });

  it("cleans the same noise out of models.dev prices, keeping real digits", () => {
    const model = normalizeModelsDevModel(
      {
        id: "m",
        name: "M",
        attachment: false,
        reasoning: false,
        tool_call: true,
        open_weights: false,
        release_date: "2025-01-01",
        last_updated: "2025-01-01",
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1000, output: 100 },
        cost: { input: 2.499999, output: 10, cache_read: 0.024999999999999998 },
      },
      "acme",
    );
    expect(model.cost?.cache_read).toBe(0.025);
    expect(model.cost?.input).toBe(2.499999);
    expect(model.cost?.cache_write).toBeUndefined();
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

  it("gives no api_id for a vendor's model: the vendor's API may not know OpenRouter's id", () => {
    expect(normalizeOpenRouterModel(mockModel).api_id).toBeUndefined();
    expect(
      normalizeOpenRouterModel({ ...mockModel, id: "openai/gpt-4o:batch" }).api_id,
    ).toBeUndefined();
  });

  it("uses OpenRouter's own id as api_id for OpenRouter's own models", () => {
    expect(normalizeOpenRouterModel({ ...mockModel, id: "openrouter/auto" }).api_id).toBe(
      "openrouter/auto",
    );
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

  it("infers tool_call capability from supported_parameters", () => {
    const modelWithTools: OpenRouterModel = {
      ...mockModel,
      supported_parameters: ["temperature", "tools", "tool_choice"],
    };
    const result = normalizeOpenRouterModel(modelWithTools);
    expect(result.capabilities.tool_call).toBe(true);
  });

  it("infers structured_output capability from supported_parameters", () => {
    const modelWithFormat: OpenRouterModel = {
      ...mockModel,
      supported_parameters: ["temperature", "response_format"],
    };
    const result = normalizeOpenRouterModel(modelWithFormat);
    expect(result.capabilities.structured_output).toBe(true);
  });

  it("infers reasoning capability from pricing", () => {
    const modelWithReasoning: OpenRouterModel = {
      ...mockModel,
      pricing: {
        ...mockModel.pricing,
        internal_reasoning: "0.000003",
      },
    };
    const result = normalizeOpenRouterModel(modelWithReasoning);
    expect(result.capabilities.reasoning).toBe(true);
  });

  it("infers reasoning from the reasoning parameter, which most reasoning models bill as output", () => {
    // e.g. anthropic/claude-haiku-5.5: "reasoning" in supported_parameters, no internal_reasoning price
    const result = normalizeOpenRouterModel({
      ...mockModel,
      supported_parameters: ["temperature", "reasoning", "include_reasoning"],
    });
    expect(result.capabilities.reasoning).toBe(true);
  });

  it("does not infer capabilities without evidence", () => {
    const result = normalizeOpenRouterModel(mockModel);
    expect(result.capabilities.tool_call).toBeUndefined();
    expect(result.capabilities.structured_output).toBeUndefined();
    expect(result.capabilities.reasoning).toBeUndefined();
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

  it("keeps the provider's own id as api_id", () => {
    expect(normalizeModelsDevModel(mockModel, "openai").api_id).toBe("gpt-4o");
    const routed = normalizeModelsDevModel(
      { ...mockModel, id: "anthropic/claude-opus-4.5" },
      "openrouter",
    );
    expect(routed.id).toBe("openrouter/anthropic/claude-opus-4.5");
    expect(routed.api_id).toBe("anthropic/claude-opus-4.5");
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

describe("mergeModels", () => {
  const openrouter: UnifiedModel = {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    context_length: 163840,
    output_limit: 16000,
    cost: { input: 0.14, output: 0.28 },
    modalities: { input: ["text"], output: ["text"] },
    capabilities: { tool_call: true },
    sources: { openrouter: true, models_dev: false },
  };

  const modelsDev: UnifiedModel = {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    context_length: 1000000,
    output_limit: 384000,
    cost: { input: 0.14, output: 0.28 },
    modalities: { input: ["text"], output: ["text"] },
    capabilities: { tool_call: true },
    family: "deepseek",
    sources: { openrouter: false, models_dev: true },
  };

  it("takes context and output from the same source", () => {
    const merged = mergeModels(openrouter, modelsDev);
    expect(merged.context_length).toBe(1000000);
    expect(merged.output_limit).toBe(384000);
  });

  it("never reports an output limit above the context window", () => {
    const merged = mergeModels(openrouter, { ...modelsDev, context_length: 200000 });
    expect(merged.output_limit).toBe(200000);
  });

  it("falls back to OpenRouter limits when models.dev has none", () => {
    const merged = mergeModels(openrouter, {
      ...modelsDev,
      context_length: undefined as unknown as number,
      output_limit: undefined,
    });
    expect(merged.context_length).toBe(163840);
    expect(merged.output_limit).toBe(16000);
  });

  it("marks both sources", () => {
    expect(mergeModels(openrouter, modelsDev).sources).toEqual({
      openrouter: true,
      models_dev: true,
    });
  });

  it("keeps the models.dev id and OpenRouter's as openrouter_id", () => {
    const merged = mergeModels(
      {
        ...openrouter,
        id: "anthropic/claude-opus-4.5",
        openrouter_id: "anthropic/claude-opus-4.5",
      },
      { ...modelsDev, id: "anthropic/claude-opus-4-5", provider: "anthropic" },
    );
    expect(merged.id).toBe("anthropic/claude-opus-4-5");
    expect(merged.provider).toBe("anthropic");
    expect(merged.openrouter_id).toBe("anthropic/claude-opus-4.5");
  });

  it("takes api_id from models.dev", () => {
    const merged = mergeModels(
      {
        ...openrouter,
        id: "anthropic/claude-opus-4.5",
        openrouter_id: "anthropic/claude-opus-4.5",
      },
      {
        ...modelsDev,
        id: "anthropic/claude-opus-4-5",
        api_id: "claude-opus-4-5",
        provider: "anthropic",
      },
    );
    expect(merged.api_id).toBe("claude-opus-4-5");
  });

  it("lets models.dev win on release date and status", () => {
    const merged = mergeModels(
      { ...openrouter, release_date: "2025-01-01", status: "deprecated" },
      { ...modelsDev, release_date: "2024-12-26", status: "beta" },
    );
    expect(merged.release_date).toBe("2024-12-26");
    expect(merged.status).toBe("beta");
  });

  it("keeps OpenRouter's date and deprecation when models.dev has none", () => {
    const merged = mergeModels(
      { ...openrouter, release_date: "2025-01-01", status: "deprecated" },
      {
        ...modelsDev,
        release_date: undefined,
        status: undefined,
      },
    );
    expect(merged.release_date).toBe("2025-01-01");
    expect(merged.status).toBe("deprecated");
  });
});

describe("normalizeOpenRouterModel data quality", () => {
  const base: OpenRouterModel = {
    id: "acme/model-1.5",
    canonical_slug: "acme/model-1.5",
    name: "Model 1.5",
    description: "",
    created: 1700000000, // 2023-11-14T22:13:20Z
    context_length: 1000,
    supported_parameters: [],
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
      tokenizer: "Other",
    },
    pricing: { prompt: "0", completion: "0" },
    top_provider: { context_length: 1000, max_completion_tokens: 100, is_moderated: false },
    links: { details: "/x" },
  };

  it("records its own id as openrouter_id", () => {
    expect(normalizeOpenRouterModel(base).openrouter_id).toBe("acme/model-1.5");
  });

  it("dates the model from created, in UTC", () => {
    expect(normalizeOpenRouterModel(base).release_date).toBe("2023-11-14");
    expect(normalizeOpenRouterModel({ ...base, created: 1700006400 }).release_date).toBe(
      "2023-11-15",
    );
  });

  it("marks a model with an expiration date as deprecated", () => {
    expect(normalizeOpenRouterModel(base).status).toBeUndefined();
    expect(normalizeOpenRouterModel({ ...base, expiration_date: "2026-10-31" }).status).toBe(
      "deprecated",
    );
  });
});

describe("looseModelKey", () => {
  it("ignores case and dots versus dashes", () => {
    expect(looseModelKey("anthropic/claude-opus-4.5")).toBe(
      looseModelKey("anthropic/claude-opus-4-5"),
    );
    expect(looseModelKey("minimax/minimax-m2.7")).toBe(looseModelKey("minimax/MiniMax-M2.7"));
    expect(looseModelKey("openai/gpt-4o")).not.toBe(looseModelKey("openai/gpt-4o-mini"));
  });
});

describe("fetchUnifiedData merging", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    setCacheEnabled(false);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function openRouterEntry(id: string) {
    return {
      id,
      canonical_slug: id,
      name: id,
      description: "",
      created: 1700000000,
      context_length: 200000,
      supported_parameters: ["tools"],
      architecture: {
        modality: "text->text",
        input_modalities: ["text"],
        output_modalities: ["text"],
        tokenizer: "Claude",
      },
      pricing: { prompt: "0.000003", completion: "0.000015" },
      top_provider: { context_length: 200000, max_completion_tokens: 32000, is_moderated: false },
      links: { details: "/x" },
    };
  }

  function modelsDevEntry(id: string) {
    return {
      id,
      name: id,
      attachment: true,
      reasoning: true,
      tool_call: true,
      open_weights: false,
      release_date: "2025-09-29",
      last_updated: "2025-09-29",
      modalities: { input: ["text"], output: ["text"] },
      limit: { context: 200000, output: 64000 },
    };
  }

  function serve(openRouterIds: string[], modelsDevIds: string[]) {
    const openRouter = { data: openRouterIds.map(openRouterEntry) };
    const modelsDev = {
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        doc: "https://docs.anthropic.com",
        env: ["ANTHROPIC_API_KEY"],
        npm: "@ai-sdk/anthropic",
        models: Object.fromEntries(modelsDevIds.map((id) => [id, modelsDevEntry(id)])),
      },
    };
    globalThis.fetch = mock((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.includes("openrouter") ? openRouter : modelsDev), {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch;
  }

  it("merges ids that differ only by dots, under the models.dev id", async () => {
    serve(["anthropic/claude-sonnet-4.5"], ["claude-sonnet-4-5"]);
    const { models } = await fetchUnifiedData();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("anthropic/claude-sonnet-4-5");
    expect(models[0].openrouter_id).toBe("anthropic/claude-sonnet-4.5");
    expect(models[0].output_limit).toBe(64000);
    expect(models[0].sources).toEqual({ openrouter: true, models_dev: true });
  });

  it("prefers an exact id over a loose one", async () => {
    serve(["anthropic/claude-x-1.5", "anthropic/claude-x-1-5"], ["claude-x-1-5"]);
    const { models } = await fetchUnifiedData();
    const exact = models.find((m) => m.id === "anthropic/claude-x-1-5");
    expect(exact?.openrouter_id).toBe("anthropic/claude-x-1-5");
    expect(models.find((m) => m.id === "anthropic/claude-x-1.5")?.sources.models_dev).toBe(false);
  });

  it("does not merge when the loose key is ambiguous", async () => {
    serve(["anthropic/claude-y-2.0"], ["claude-y-2-0", "Claude-Y-2-0"]);
    const { models } = await fetchUnifiedData();
    expect(models).toHaveLength(3);
    expect(models.find((m) => m.id === "anthropic/claude-y-2.0")?.sources.models_dev).toBe(false);
  });

  it("still resolves the OpenRouter spelling of a merged model", async () => {
    serve(["anthropic/claude-sonnet-4.5"], ["claude-sonnet-4-5"]);
    const { models } = await fetchUnifiedData();
    expect(pickBestModel(models, "claude-sonnet-4.5")?.id).toBe("anthropic/claude-sonnet-4-5");
    expect(pickBestModel(models, "anthropic/claude-sonnet-4.5")?.id).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });
});
