// Models that run inside the browser on WebGPU through WebLLM (@mlc-ai/web-llm),
// and a pick of the best one a device can hold.
//
// The catalog (src/data/browser-models.json) is extracted from WebLLM's
// published prebuiltAppConfig by scripts/build-browser-models.ts; nothing in it
// is typed by hand. This module only adds what the id and the vendors' model
// cards tell: family, generation, size, quantization, languages, and a small
// table of published benchmark scores. Every hand-kept fact cites its source.
// The library never imports @mlc-ai/web-llm.

import catalogJson from "../data/browser-models.json";
import {
  BrowserModelCatalogSchema,
  BrowserModelRecommendationOptionsSchema,
} from "../schemas/functions";
import type {
  BrowserModel,
  BrowserModelCatalog,
  BrowserModelNeed,
  BrowserModelQuality,
  BrowserModelRecommendation,
  BrowserModelRecommendationOptions,
  BrowserModelRecord,
} from "../types";

// --- Families and generations -------------------------------------------
//
// `released` is the month the vendor announced the series (blog or model card).
// Where the vendor published no date, it is the creation month of the vendor's
// Hugging Face repo (https://huggingface.co/api/models/<repo>, `createdAt`),
// marked "HF createdAt". `multilingual` is true only when the model card claims
// languages beyond English; "English" or no claim at all leaves it false.
// `hybrid_reasoning` marks chat models that think on request: WebLLM toggles it
// with `extra_body.enable_thinking` and `<think>` blocks (Qwen3 style).

interface Series {
  /** Matched against the WebLLM model id. First match wins. */
  match: RegExp;
  family: string;
  series: string;
  /** YYYY-MM the vendor released the series. */
  released: string;
  /** The model card claims languages beyond English. */
  multilingual: boolean;
  /** Chat models that can also think step by step (hybrid thinking). */
  hybrid_reasoning?: boolean;
  /** A fine-tune of an existing model (language, task): not a new generation. */
  specialization?: boolean;
  /** Model card or vendor post backing `released`, `multilingual`, `hybrid_reasoning`. */
  source: string;
}

const SERIES: Series[] = [
  // "Expanded support to 201 languages and dialects"; "Qwen3.5 models support
  // both non-thinking and thinking mode"; card citation: February 2026.
  {
    match: /^Qwen3\.5-/,
    family: "qwen",
    series: "Qwen3.5",
    released: "2026-02",
    multilingual: true,
    hybrid_reasoning: true,
    source: "https://huggingface.co/Qwen/Qwen3.5-4B",
  },
  // "Support of 100+ languages and dialects"; "seamless switching between
  // thinking mode … and non-thinking mode"; blog dated 2025-04-29.
  {
    match: /^Qwen3-/,
    family: "qwen",
    series: "Qwen3",
    released: "2025-04",
    multilingual: true,
    hybrid_reasoning: true,
    source: "https://qwenlm.github.io/blog/qwen3/",
  },
  // "Multilingual support for over 29 languages"; blog dated 2024-09-19.
  {
    match: /^Qwen2\.5-/,
    family: "qwen",
    series: "Qwen2.5",
    released: "2024-09",
    multilingual: true,
    source: "https://qwenlm.github.io/blog/qwen2.5/",
  },
  // "trained on data in 27 additional languages besides English and Chinese"; 2024-06-07.
  {
    match: /^Qwen2-/,
    family: "qwen",
    series: "Qwen2",
    released: "2024-06",
    multilingual: true,
    source: "https://qwenlm.github.io/blog/qwen2/",
  },
  // Reasoning-only distillations; the card makes no language claim. HF createdAt 2025-01.
  {
    match: /^DeepSeek-R1-Distill-/,
    family: "deepseek",
    series: "DeepSeek-R1-Distill",
    released: "2025-01",
    multilingual: false,
    source: "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  },
  // Llama 3.2 / 3.1: "English, German, French, Italian, Portuguese, Hindi,
  // Spanish, and Thai are officially supported".
  {
    match: /^Llama-3\.2-/,
    family: "llama",
    series: "Llama-3.2",
    released: "2024-09",
    multilingual: true,
    source:
      "https://raw.githubusercontent.com/meta-llama/llama-models/main/models/llama3_2/MODEL_CARD.md",
  },
  {
    match: /^Llama-3\.1-/,
    family: "llama",
    series: "Llama-3.1",
    released: "2024-07",
    multilingual: true,
    source:
      "https://raw.githubusercontent.com/meta-llama/llama-models/main/models/llama3_1/MODEL_CARD.md",
  },
  // Out of scope: "Use in languages other than English".
  {
    match: /^Llama-3-/,
    family: "llama",
    series: "Llama-3",
    released: "2024-04",
    multilingual: false,
    source:
      "https://raw.githubusercontent.com/meta-llama/llama-models/main/models/llama3/MODEL_CARD.md",
  },
  {
    match: /^Llama-2-/,
    family: "llama",
    series: "Llama-2",
    released: "2023-07",
    multilingual: false,
    source: "https://huggingface.co/meta-llama/Llama-2-7b-chat-hf (HF createdAt)",
  },
  // Nous Research fine-tunes of Llama / Mistral; cards list `en` only. HF createdAt.
  {
    match: /^Hermes-3-Llama-3\.2-/,
    family: "hermes",
    series: "Hermes-3",
    released: "2024-12",
    multilingual: false,
    source: "https://huggingface.co/NousResearch/Hermes-3-Llama-3.2-3B (HF createdAt)",
  },
  {
    match: /^Hermes-3-/,
    family: "hermes",
    series: "Hermes-3",
    released: "2024-07",
    multilingual: false,
    source: "https://huggingface.co/NousResearch/Hermes-3-Llama-3.1-8B (HF createdAt)",
  },
  {
    match: /^Hermes-2-Theta-/,
    family: "hermes",
    series: "Hermes-2-Theta",
    released: "2024-05",
    multilingual: false,
    source: "https://huggingface.co/NousResearch/Hermes-2-Theta-Llama-3-8B (HF createdAt)",
  },
  {
    match: /^Hermes-2-Pro-Llama-/,
    family: "hermes",
    series: "Hermes-2-Pro",
    released: "2024-04",
    multilingual: false,
    source: "https://huggingface.co/NousResearch/Hermes-2-Pro-Llama-3-8B (HF createdAt)",
  },
  {
    match: /^Hermes-2-Pro-Mistral-/,
    family: "hermes",
    series: "Hermes-2-Pro",
    released: "2024-03",
    multilingual: false,
    source: "https://huggingface.co/NousResearch/Hermes-2-Pro-Mistral-7B (HF createdAt)",
  },
  {
    match: /^OpenHermes-2\.5-/,
    family: "hermes",
    series: "OpenHermes-2.5",
    released: "2023-10",
    multilingual: false,
    source: "https://huggingface.co/teknium/OpenHermes-2.5-Mistral-7B (HF createdAt)",
  },
  {
    match: /^NeuralHermes-2\.5-/,
    family: "hermes",
    series: "NeuralHermes-2.5",
    released: "2023-11",
    multilingual: false,
    source: "https://huggingface.co/mlabonne/NeuralHermes-2.5-Mistral-7B (HF createdAt)",
  },
  // Phi-4-mini / Phi-3.5-mini: "Supported languages: Arabic, Chinese, Czech, …" (23).
  {
    match: /^Phi-4-mini-/,
    family: "phi",
    series: "Phi-4-mini",
    released: "2025-02",
    multilingual: true,
    source: "https://huggingface.co/microsoft/Phi-4-mini-instruct",
  },
  {
    match: /^Phi-3\.5-/,
    family: "phi",
    series: "Phi-3.5",
    released: "2024-08",
    multilingual: true,
    source: "https://huggingface.co/microsoft/Phi-3.5-mini-instruct",
  },
  // "intended for broad commercial and research use in English".
  {
    match: /^Phi-3-/,
    family: "phi",
    series: "Phi-3",
    released: "2024-04",
    multilingual: false,
    source: "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct",
  },
  // Base models: "The model has not undergone instruction fine-tuning".
  {
    match: /^phi-2-/,
    family: "phi",
    series: "phi-2",
    released: "2023-12",
    multilingual: false,
    source: "https://huggingface.co/microsoft/phi-2",
  },
  {
    match: /^phi-1_5-/,
    family: "phi",
    series: "phi-1.5",
    released: "2023-09",
    multilingual: false,
    source: "https://huggingface.co/microsoft/phi-1_5",
  },
  // "Supports dozens of languages, including English, French, Spanish, …"; 2025-12-02.
  {
    match: /^Ministral-3-/,
    family: "mistral",
    series: "Ministral-3",
    released: "2025-12",
    multilingual: true,
    source: "https://mistral.ai/news/mistral-3",
  },
  // The v0.3 / v0.2 cards make no language claim. HF createdAt.
  {
    match: /^Mistral-7B-Instruct-v0\.3-/,
    family: "mistral",
    series: "Mistral-7B-v0.3",
    released: "2024-05",
    multilingual: false,
    source: "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3 (HF createdAt)",
  },
  {
    match: /^Mistral-7B-Instruct-v0\.2-/,
    family: "mistral",
    series: "Mistral-7B-v0.2",
    released: "2023-12",
    multilingual: false,
    source: "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2 (HF createdAt)",
  },
  {
    match: /^WizardMath-/,
    family: "wizardlm",
    series: "WizardMath-V1.1",
    released: "2023-12",
    multilingual: false,
    source: "https://huggingface.co/WizardLMTeam/WizardMath-7B-V1.1 (HF createdAt)",
  },
  // "SmolLM2 models primarily understand and generate content in English". HF createdAt.
  {
    match: /^SmolLM2-/,
    family: "smollm",
    series: "SmolLM2",
    released: "2024-10",
    multilingual: false,
    source: "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct",
  },
  // "Out-of-the-box support for 35+ languages, pre-trained on 140+ languages"; 2026-04-02.
  {
    match: /^gemma-4-/,
    family: "gemma",
    series: "gemma-4",
    released: "2026-04",
    multilingual: true,
    source: "https://huggingface.co/google/gemma-4-E2B-it",
  },
  // "multilingual support in over 140 languages"; 2025-03-12.
  {
    match: /^gemma3-|^gemma-3-/,
    family: "gemma",
    series: "gemma-3",
    released: "2025-03",
    multilingual: true,
    source: "https://ai.google.dev/gemma/docs/core/model_card_3",
  },
  // "fine-tuned on Japanese text. It supports the Japanese language". HF createdAt.
  {
    match: /^gemma-2-2b-jpn-/,
    family: "gemma",
    series: "gemma-2-jpn",
    released: "2024-09",
    multilingual: true,
    specialization: true,
    source: "https://huggingface.co/google/gemma-2-2b-jpn-it",
  },
  // "available in English"; 9B announced 2024-06-27, 2B 2024-07-31.
  {
    match: /^gemma-2-/,
    family: "gemma",
    series: "gemma-2",
    released: "2024-06",
    multilingual: false,
    source: "https://ai.google.dev/gemma/docs/core/model_card_2",
  },
  {
    match: /^gemma-2b-/,
    family: "gemma",
    series: "gemma",
    released: "2024-02",
    multilingual: false,
    source: "https://huggingface.co/google/gemma-2b-it (HF createdAt)",
  },
  // "Language(s) (NLP): Primarily English".
  {
    match: /^OLMo-2-0425-/,
    family: "olmo",
    series: "OLMo-2-0425",
    released: "2025-04",
    multilingual: false,
    source: "https://huggingface.co/allenai/OLMo-2-0425-1B-Instruct",
  },
  {
    match: /^OLMo-2-1124-/,
    family: "olmo",
    series: "OLMo-2-1124",
    released: "2024-11",
    multilingual: false,
    source: "https://allenai.org/blog/olmo2",
  },
  // "Language(s): English" (both cards).
  {
    match: /^stablelm-2-zephyr-/,
    family: "stablelm",
    series: "StableLM-2-Zephyr",
    released: "2024-01",
    multilingual: false,
    source: "https://huggingface.co/stabilityai/stablelm-2-zephyr-1_6b (HF createdAt)",
  },
  {
    match: /^RedPajama-INCITE-/,
    family: "redpajama",
    series: "RedPajama-INCITE",
    released: "2023-05",
    multilingual: false,
    source: "https://huggingface.co/togethercomputer/RedPajama-INCITE-Chat-3B-v1 (HF createdAt)",
  },
  {
    match: /^TinyLlama-1\.1B-Chat-v1\.0-/,
    family: "tinyllama",
    series: "TinyLlama-v1.0",
    released: "2023-12",
    multilingual: false,
    source: "https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0 (HF createdAt)",
  },
  {
    match: /^TinyLlama-1\.1B-Chat-v0\.4-/,
    family: "tinyllama",
    series: "TinyLlama-v0.4",
    released: "2023-11",
    multilingual: false,
    source: "https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v0.4 (HF createdAt)",
  },
  {
    match: /^snowflake-arctic-embed-/,
    family: "snowflake",
    series: "arctic-embed",
    released: "2024-04",
    multilingual: false,
    source: "https://huggingface.co/Snowflake/snowflake-arctic-embed-s (HF createdAt)",
  },
];

// --- Published quality scores --------------------------------------------
//
// One metric, so scores compare: MMLU-Redux of the instruct model, in
// non-thinking mode when the source reports both. Most rows come from the two
// Qwen technical reports, which ran their competitors under the same protocol:
//   QWEN3  = Qwen3 Technical Report, arXiv:2505.09388, Tables 18 and 20
//   QWEN25 = Qwen2.5 Technical Report, arXiv:2412.15115, Tables 8-10
// Self-reported, vendor-run numbers: read them as an ordering, not a truth.
// Not in the table, because no comparable figure is published: Qwen3.5-4B/9B
// (thinking mode only), Llama-3.2, Llama-3, gemma-4 (MMLU-Pro only), Ministral-3
// (base model only), SmolLM2, OLMo-2, Mistral-7B and the community fine-tunes.
// Those are ranked by the rule in `effectiveScore` and by generation and size.

const QWEN3 = "Qwen3 Technical Report, arXiv:2505.09388";
const QWEN25 = "Qwen2.5 Technical Report, arXiv:2412.15115";
const QWEN35_CARD = "https://huggingface.co/Qwen/Qwen3.5-0.8B";

const redux = (value: number, source: string): BrowserModelQuality => ({
  metric: "MMLU-Redux",
  value,
  source,
});

/** Keyed by the WebLLM id without its quantization suffix (see `baseId`). */
export const QUALITY: Readonly<Record<string, BrowserModelQuality>> = {
  "Qwen3.5-0.8B": redux(48.5, `${QWEN35_CARD}, Language table, non-thinking`),
  "Qwen3.5-2B": redux(69.2, `${QWEN35_CARD}, Language table, non-thinking`),
  "Qwen3-0.6B": redux(44.6, `${QWEN3}, Table 20, non-thinking`),
  "Qwen3-1.7B": redux(64.4, `${QWEN3}, Table 20, non-thinking`),
  "Qwen3-4B": redux(77.3, `${QWEN3}, Table 18, non-thinking`),
  "Qwen3-8B": redux(79.5, `${QWEN3}, Table 18, non-thinking`),
  "Qwen2.5-0.5B-Instruct": redux(24.1, `${QWEN25}, Table 10`),
  "Qwen2.5-1.5B-Instruct": redux(50.7, `${QWEN3}, Table 20`),
  "Qwen2.5-3B-Instruct": redux(64.4, `${QWEN3}, Table 20`),
  "Qwen2.5-7B-Instruct": redux(75.4, `${QWEN3}, Table 18`),
  "Qwen2-0.5B-Instruct": redux(12.9, `${QWEN25}, Table 10`),
  "Qwen2-1.5B-Instruct": redux(41.2, `${QWEN25}, Table 10`),
  "Qwen2-7B-Instruct": redux(67.3, `${QWEN25}, Table 8`),
  // The Qwen2.5 report (Table 8) gives 67.2; the newer run is kept.
  "Llama-3.1-8B-Instruct": redux(61.7, `${QWEN3}, Table 18`),
  "gemma3-1b-it": redux(33.3, `${QWEN3}, Table 20`),
  "gemma-2-2b-it": redux(51.9, `${QWEN25}, Table 9`),
  "gemma-2-9b-it": redux(72.8, `${QWEN25}, Table 8`),
  "Phi-4-mini-instruct": redux(67.9, `${QWEN3}, Table 20`),
  "Phi-3.5-mini-instruct": redux(67.7, `${QWEN25}, Table 9`),
};

function seriesOf(modelId: string): Series | undefined {
  return SERIES.find((s) => s.match.test(modelId));
}

// --- Derivation -----------------------------------------------------------

const QUANT_RE = /-(q(\d)f(16|32)(?:_\d+)?)(?:-MLC)?(?:-.*)?$/;

/** "Qwen3-4B-q4f16_1-MLC" → "Qwen3-4B"; "Phi-3.5-mini-instruct-q4f16_1-MLC-1k" → "Phi-3.5-mini-instruct". */
export function baseId(modelId: string): string {
  return modelId.replace(/-q\d+f(16|32)(_\d+)?-MLC.*$/, "");
}

/** Billions of parameters named in the id: "1.5B", "135M", "1_6b", "E2B". */
function paramsFromId(modelId: string): number | null {
  for (const token of baseId(modelId).split("-")) {
    const m = token.match(/^E?(\d+(?:[._]\d+)?)([BbMm])$/);
    if (!m?.[1] || !m[2]) continue;
    const n = Number(m[1].replace("_", "."));
    return m[2].toLowerCase() === "m" ? n / 1000 : n;
  }
  return null;
}

function variantOf(id: string, kind: BrowserModel["kind"], base: boolean): BrowserModel["variant"] {
  if (kind === "embedding") return "embedding";
  if (kind === "vlm") return "vision";
  if (base) return "base";
  if (/Coder/.test(id)) return "coder";
  if (/Math/.test(id)) return "math";
  if (/R1-Distill|-Reasoning-/.test(id)) return "reasoning";
  return "chat";
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Turns one extracted catalog record into a described browser model. */
export function describeBrowserModel(record: BrowserModelRecord): BrowserModel {
  const id = record.model_id;
  const quant = id.match(QUANT_RE);
  if (!quant?.[1] || !quant[2] || !quant[3]) throw new Error(`${id}: no quantization in id`);
  const computeBits = Number(quant[3]);
  const series = seriesOf(id);
  const fromId = paramsFromId(id);
  const fromWeights =
    record.param_bytes && record.bits_per_param
      ? round((record.param_bytes * 8) / record.bits_per_param / 1e9, 2)
      : null;
  const variant = variantOf(id, record.model_type, /-Base-|^phi-1_5|^phi-2/.test(id));
  return {
    id,
    family: series?.family ?? (id.split("-")[0] ?? id).toLowerCase(),
    series: series?.series ?? baseId(id),
    released: series?.released ?? null,
    kind: record.model_type,
    variant,
    params_b: fromId ?? fromWeights,
    params_source: fromId != null ? "id" : fromWeights != null ? "weights" : null,
    quantization: quant[1],
    weight_bits: quant[2] === "0" ? computeBits : Number(quant[2]),
    compute_dtype: computeBits === 16 ? "f16" : "f32",
    vram_required_mb: record.vram_required_mb,
    low_resource_required: record.low_resource_required,
    context_window: record.context_window,
    max_context_window: record.config_context_window,
    download_mb: record.weights_bytes == null ? null : round(record.weights_bytes / 1e6, 1),
    hf_repo: record.model,
    model_lib: record.model_lib,
    required_features: record.required_features,
    // WebLLM README: "Structured JSON Generation: WebLLM supports state-of-the-art
    // JSON mode structured generation, implemented in the WebAssembly portion of
    // the model library" (response_format json_object + schema, or grammar). Its
    // request checks put no model restriction on response_format, unlike `tools`
    // (functionCallingModelIds). Embedding models do not generate text.
    // https://github.com/mlc-ai/web-llm#key-features
    structured_output: record.model_type !== "embedding",
    function_calling: record.function_calling,
    reasoning: variant === "reasoning" || (variant === "chat" && series?.hybrid_reasoning === true),
    multilingual: series?.multilingual ?? false,
    quality: QUALITY[baseId(id)] ?? null,
  };
}

// --- Catalog ----------------------------------------------------------------

let catalog: BrowserModelCatalog | undefined;
let described: BrowserModel[] | undefined;

/** The extracted WebLLM catalog, validated once. */
export function browserModelCatalog(): BrowserModelCatalog {
  catalog ??= BrowserModelCatalogSchema.parse(catalogJson);
  return catalog;
}

/** Every prebuilt WebLLM model, described. Synchronous: the catalog ships with the package. */
export function listBrowserModels(): BrowserModel[] {
  described ??= browserModelCatalog().models.map(describeBrowserModel);
  return structuredClone(described);
}

// --- Recommendation -------------------------------------------------------
//
// Ranking, in order (each rule only breaks ties left by the ones above):
// 1. A model loaded with WebLLM's full 4,096-token context beats a reduced
//    "-1k"/2k variant: a page of notes and an answer do not fit in 1,024 tokens.
// 2. Published quality: the MMLU-Redux score of the QUALITY table. A model
//    without one is placed at the best score of the older models of its own
//    family that are no larger: the vendor's newer generation is not ranked
//    below the one it supersedes (Qwen3.5-4B at least at Qwen3-4B's level).
//    A specialization (gemma-2-2b-jpn) is not a new generation and inherits nothing.
//    Models with no score at all rank after every scored model.
// 3. Newer generation (`released`), then more parameters.
// 4. Quantization: q4f16 first. It needs the least VRAM of a model's builds,
//    and fp16 compute is WebGPU's fast path when the adapter has shader-f16.
// 5. Wider context, then less VRAM.

/** Preferred quantization first. */
const QUANT_PREFERENCE = ["q4f16", "q4f32", "q3f16", "q0f16", "q0f32"];

function quantRank(m: BrowserModel): number {
  const i = QUANT_PREFERENCE.indexOf(m.quantization.replace(/_\d+$/, ""));
  return i < 0 ? QUANT_PREFERENCE.length : i;
}

const FULL_CONTEXT = 4096;

interface Scored {
  model: BrowserModel;
  /** Own score, or the one inherited from an older same-family model. */
  score: number | null;
  /** The model the score comes from, when inherited. */
  inherited_from?: BrowserModel;
}

/** Rule 2: the model's own score, else the best older, no larger, same-family score. */
function effectiveScore(m: BrowserModel, all: BrowserModel[]): Scored {
  if (m.quality) return { model: m, score: m.quality.value };
  if (seriesOf(m.id)?.specialization) return { model: m, score: null };
  let best: BrowserModel | undefined;
  for (const other of all) {
    if (!other.quality || other.family !== m.family) continue;
    if (!other.released || !m.released || other.released >= m.released) continue;
    if (other.params_b == null || m.params_b == null || other.params_b > m.params_b) continue;
    if (!best?.quality || other.quality.value > best.quality.value) best = other;
  }
  return best?.quality
    ? { model: m, score: best.quality.value, inherited_from: best }
    : { model: m, score: null };
}

function compare(x: Scored, y: Scored): number {
  const a = x.model;
  const b = y.model;
  const fullA = (a.context_window ?? 0) >= FULL_CONTEXT ? 1 : 0;
  const fullB = (b.context_window ?? 0) >= FULL_CONTEXT ? 1 : 0;
  if (fullA !== fullB) return fullB - fullA;
  if (x.score !== y.score) {
    if (x.score == null) return 1;
    if (y.score == null) return -1;
    return y.score - x.score;
  }
  const relA = a.released ?? "";
  const relB = b.released ?? "";
  if (relA !== relB) return relA < relB ? 1 : -1;
  if ((a.params_b ?? 0) !== (b.params_b ?? 0)) return (b.params_b ?? 0) - (a.params_b ?? 0);
  const qa = quantRank(a);
  const qb = quantRank(b);
  if (qa !== qb) return qa - qb;
  if ((a.context_window ?? 0) !== (b.context_window ?? 0)) {
    return (b.context_window ?? 0) - (a.context_window ?? 0);
  }
  return a.vram_required_mb - b.vram_required_mb;
}

interface FitOptions {
  vram_budget_mb: number;
  download_budget_mb?: number;
  shader_f16?: boolean;
  low_resource?: boolean;
}

/** Chat models only (reasoning-only ones when reasoning is needed) that meet every constraint. */
function fits(m: BrowserModel, opts: FitOptions, needs: Set<BrowserModelNeed>): boolean {
  if (m.kind !== "llm") return false;
  if (m.variant !== "chat" && !(m.variant === "reasoning" && needs.has("reasoning"))) return false;
  if (m.vram_required_mb > opts.vram_budget_mb) return false;
  if (opts.download_budget_mb != null) {
    if (m.download_mb == null || m.download_mb > opts.download_budget_mb) return false;
  }
  if (opts.shader_f16 === false) {
    if (m.compute_dtype === "f16" || m.required_features.includes("shader-f16")) return false;
  }
  if (opts.low_resource && !m.low_resource_required) return false;
  if (needs.has("json") && !m.structured_output) return false;
  if (needs.has("multilingual") && !m.multilingual) return false;
  if (needs.has("reasoning") && !m.reasoning) return false;
  return true;
}

function describeReason(
  pick: Scored,
  opts: FitOptions,
  needs: Set<BrowserModelNeed>,
  candidates: number,
): string {
  const m = pick.model;
  const size = m.params_b != null ? `${m.params_b}B` : "unknown size";
  const parts = [
    `${m.series} ${size} (${m.quantization}) needs ${Math.round(m.vram_required_mb)} MB of GPU memory, within the ${Math.round(opts.vram_budget_mb)} MB budget; ${candidates} model${candidates === 1 ? "" : "s"} fit.`,
  ];
  if (m.quality) {
    parts.push(
      `Best published score among them: ${m.quality.metric} ${m.quality.value} (${m.quality.source}).`,
    );
  } else if (pick.inherited_from?.quality) {
    const from = pick.inherited_from;
    const q = from.quality as BrowserModelQuality;
    parts.push(
      `No comparable published score for ${m.series} ${size}; ranked at least level with ${baseId(from.id)} (${q.metric} ${q.value}, ${q.source}), the older ${m.family} model it supersedes.`,
    );
  } else {
    parts.push(
      `No published score covers it, so it is ranked by generation (${m.series}, ${m.released ?? "date unknown"}) and size only.`,
    );
  }
  if (needs.size > 0) parts.push(`Meets: ${[...needs].join(", ")}.`);
  if ((m.context_window ?? 0) < FULL_CONTEXT) {
    parts.push(`Context is reduced to ${m.context_window ?? "?"} tokens to fit.`);
  }
  if (m.compute_dtype === "f16") {
    parts.push(
      "fp16 compute: the WebGPU adapter must expose shader-f16 (else pass shader_f16: false).",
    );
  }
  return parts.join(" ");
}

/**
 * The best browser model for a device: the highest-ranked WebLLM chat model
 * whose published VRAM requirement (and weight download) fits the budget, with
 * the reason and up to 3 runner-ups (one build per model). Returns null when
 * nothing fits. Pass `models` to rank another list than the shipped catalog.
 */
export function recommendBrowserModel(
  options: BrowserModelRecommendationOptions,
  models: BrowserModel[] = listBrowserModels(),
): BrowserModelRecommendation | null {
  const opts = BrowserModelRecommendationOptionsSchema.parse(options);
  const needs = new Set(opts.needs ?? []);
  let pool = models.filter((m) => fits(m, opts, needs));
  if (needs.has("long_context") && pool.length > 0) {
    const widest = Math.max(...pool.map((m) => m.context_window ?? 0));
    pool = pool.filter((m) => (m.context_window ?? 0) === widest);
  }
  if (pool.length === 0) return null;
  const ranked = pool.map((m) => effectiveScore(m, models)).sort(compare);

  // One entry per model: its other builds are not alternatives.
  const seen = new Set<string>();
  const distinct = ranked.filter(({ model }) => {
    const key = baseId(model.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const [best, ...rest] = distinct as [Scored, ...Scored[]];
  return {
    model: best.model,
    reason: describeReason(best, opts, needs, distinct.length),
    alternatives: rest.slice(0, opts.alternatives ?? 3).map((s) => s.model),
  };
}
