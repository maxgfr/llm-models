import { describe, expect, it } from "bun:test";
import { acceptsInput, INPUT_MODALITIES, inputsOf, normalizeModality } from "../catalog";
import { normalizeModelsDevModel, normalizeOpenRouterModel } from "../functions/normalize";
import { filterModels } from "../functions/search";
import type { ModelsDevModel, OpenRouterModel } from "../types";

function routerModel(id: string, input: string[]): OpenRouterModel {
  return {
    id,
    canonical_slug: id,
    name: id,
    description: "",
    created: 1700000000,
    context_length: 128000,
    supported_parameters: [],
    architecture: {
      modality: "",
      input_modalities: input,
      output_modalities: ["text"],
      tokenizer: "x",
    },
    pricing: { prompt: "0", completion: "0" },
    top_provider: { context_length: 128000, max_completion_tokens: 1000, is_moderated: false },
    links: { details: "" },
  };
}

function devModel(id: string, input: string[]): ModelsDevModel {
  return {
    id,
    name: id,
    attachment: false,
    reasoning: false,
    tool_call: true,
    open_weights: false,
    release_date: "2026-01-01",
    last_updated: "2026-01-01",
    modalities: { input, output: ["text"] },
    limit: { context: 128000, output: 16384 },
  };
}

describe("input modalities", () => {
  it("names five inputs", () => {
    expect([...INPUT_MODALITIES]).toEqual(["text", "image", "pdf", "audio", "video"]);
  });

  it("reads OpenRouter's file as pdf, any case", () => {
    expect(normalizeModality("file")).toBe("pdf");
    expect(normalizeModality(" Audio ")).toBe("audio");
  });

  it("lists a slim or a full model's inputs, text only when none are listed", () => {
    expect(inputsOf({ input: ["video", "text", "image", "audio"] })).toEqual([
      "text",
      "image",
      "audio",
      "video",
    ]);
    expect(inputsOf({ modalities: { input: ["text", "file"] } })).toEqual(["text", "pdf"]);
    expect(inputsOf({})).toEqual(["text"]);
    expect(inputsOf(undefined)).toEqual(["text"]);
  });

  it("tells audio and video apart", () => {
    const gemini = { input: ["text", "image", "pdf", "audio", "video"] };
    const voxtral = { input: ["text", "audio"] };
    expect(acceptsInput(gemini, "video")).toBe(true);
    expect(acceptsInput(voxtral, "audio")).toBe(true);
    expect(acceptsInput(voxtral, "video")).toBe(false);
    expect(acceptsInput({ input: ["text", "image"] }, "audio")).toBe(false);
    expect(acceptsInput(null, "text")).toBe(true);
  });

  it("normalizes OpenRouter models to pdf, without duplicates", () => {
    const m = normalizeOpenRouterModel(
      routerModel("google/gemini", ["text", "file", "pdf", "audio"]),
    );
    expect(m.modalities.input).toEqual(["text", "pdf", "audio"]);
  });

  it("filters both sources by audio, video and pdf", () => {
    const models = [
      normalizeOpenRouterModel(routerModel("google/gemini-x", ["text", "file", "audio", "video"])),
      normalizeModelsDevModel(devModel("voxtral", ["text", "audio"]), "mistral"),
      normalizeModelsDevModel(devModel("gpt-x", ["text", "image", "pdf"]), "openai"),
    ];
    const ids = (modality: string) => filterModels(models, { modality }).map((m) => m.id);
    expect(ids("audio")).toEqual(["google/gemini-x", "mistral/voxtral"]);
    expect(ids("video")).toEqual(["google/gemini-x"]);
    expect(ids("pdf")).toEqual(["google/gemini-x", "openai/gpt-x"]);
    expect(ids("file")).toEqual(["google/gemini-x", "openai/gpt-x"]);
  });
});
