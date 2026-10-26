// What a model accepts, which decides what a request may contain. Current
// Claude models are pinned from Anthropic's documentation, because sampling,
// prefill, forced tool choice, effort and mid-conversation system messages are
// not something a catalog can say. Every other model follows its catalog entry,
// with conservative defaults for what the entry leaves out.

import { normalizeModality } from "llm-models/catalog";
import { type Effort, effortLevels, modelKey } from "./effort.js";

/** Sampling parameters a call may set. */
export type SamplingParam =
  | "temperature"
  | "topP"
  | "topK"
  | "presencePenalty"
  | "frequencyPenalty"
  | "seed";

/** Every sampling parameter, in the AI SDK's names. */
export const SAMPLING_PARAMS: readonly SamplingParam[] = [
  "temperature",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "seed",
];

/**
 * The provider's own web search: Anthropic's dynamic-filtering tool (Claude 4.6 and later),
 * Anthropic's basic tool, OpenAI's `web_search` tool, or Gemini's Google Search grounding.
 */
export type WebSearchVariant =
  | "anthropic:web_search_20260209"
  | "anthropic:web_search_20250305"
  | "openai:web_search"
  | "google:google_search";

/** Prices in US dollars per million tokens. */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  /** 5-minute cache writes. */
  cacheWrite?: number;
}

export interface Capabilities {
  /** Image input. */
  vision: boolean;
  /** Native PDF input. */
  pdf: boolean;
  /**
   * Audio in a message (a recording the model hears, not a transcription): the catalog says the
   * model hears and the protocol's SDK sends audio parts (Gemini, OpenAI-compatible servers).
   */
  audio: boolean;
  /** Video in a message: the catalog says the model watches and the protocol's SDK sends video. */
  video: boolean;
  /** Function tools. */
  tools: boolean;
  /** It reasons before answering. */
  reasoning: boolean;
  /**
   * `levels`: the efforts it takes, weakest first (empty: send none). `default`: the level the
   * provider applies when none is sent, or null when unknown.
   */
  effort: { levels: readonly Effort[]; default: Effort | null };
  /**
   * How reasoning comes back: `summarized` (a summary is requested), `raw` (the provider streams
   * its reasoning text), `hidden`, or null without reasoning.
   */
  thinkingDisplay: "summarized" | "raw" | "hidden" | null;
  /** Sampling parameters it takes with a non-default value; empty on Claude Opus 4.7 and later. */
  sampling: readonly SamplingParam[];
  /** A call may end with an assistant message the model continues. False on Claude 4.6 and later. */
  prefill: boolean;
  /** `toolChoice` may force a tool (`required` or a named tool). */
  forcedToolChoice: boolean;
  webSearch: WebSearchVariant | null;
  /** A `system` message may appear after the first message. */
  midConversationSystem: boolean;
  /** Mid-conversation tool additions and removals (Anthropic). */
  toolChanges: boolean;
  /**
   * Anthropic's server-side refusal fallback (`fallbacks: "default"`), which `callOptions` sends
   * on Anthropic's own API when asked to; null when the model has none.
   */
  refusalFallback: "default" | null;
  /** Input window in tokens. */
  contextWindow: number;
  /** Output cap in tokens. */
  maxOutput: number;
  cost: ModelCost | null;
}

/** A correction of resolved capabilities, applied last. */
export type CapabilityOverride = Partial<Capabilities>;

/**
 * What a catalog says about a model. The slim catalog's `SlimModel` (`tool_call`, `reasoning`,
 * `input`) fits; a richer source can add limits and prices.
 */
export interface CatalogModelInfo {
  id?: string;
  name?: string;
  contextWindow?: number;
  maxOutput?: number;
  /** Input modalities: `text`, `image`, `pdf`, `audio`, `video` (OpenRouter's `file` reads as `pdf`). */
  input?: readonly string[];
  reasoning?: boolean;
  toolCall?: boolean;
  /** The slim catalog's spelling of `toolCall`. */
  tool_call?: boolean;
  cost?: ModelCost;
}

const CLAUDE_SAMPLING: readonly SamplingParam[] = ["temperature", "topP", "topK"];
const DYNAMIC_SEARCH: WebSearchVariant = "anthropic:web_search_20260209";
const BASIC_SEARCH: WebSearchVariant = "anthropic:web_search_20250305";

/** Prices per million tokens; a 5-minute cache write costs 1.25 times the input price. */
const cost = (input: number, output: number, cacheRead: number): ModelCost => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

interface ClaudeRow {
  effortDefault: Effort | null;
  sampling: readonly SamplingParam[];
  prefill: boolean;
  forcedToolChoice: boolean;
  webSearch: WebSearchVariant;
  midConversationSystem: boolean;
  toolChanges: boolean;
  refusalFallback: "default" | null;
  contextWindow: number;
  maxOutput: number;
  cost: ModelCost;
}

/** The 2026 generation: no sampling, no prefill, 1M context, 128K output, mid-conversation system. */
const GEN5 = {
  sampling: [],
  prefill: false,
  midConversationSystem: true,
  contextWindow: 1_000_000,
  maxOutput: 128_000,
} as const;

/**
 * Pinned Claude models by exact id (no date suffix). Sources: Anthropic's model overview, the
 * thinking and effort table, the refusal-fallback guide and the per-model migration notes.
 */
const CLAUDE: Readonly<Record<string, ClaudeRow>> = {
  "claude-fable-5-1": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: false,
    webSearch: BASIC_SEARCH,
    toolChanges: true,
    refusalFallback: "default",
    cost: cost(10, 50, 0.25),
  },
  "claude-mythos-5-1": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: false,
    webSearch: BASIC_SEARCH,
    toolChanges: true,
    refusalFallback: null,
    cost: cost(10, 50, 0.25),
  },
  "claude-fable-5": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: true,
    webSearch: BASIC_SEARCH,
    toolChanges: false,
    refusalFallback: null,
    cost: cost(10, 50, 1),
  },
  "claude-opus-5-5": {
    ...GEN5,
    effortDefault: "medium",
    forcedToolChoice: false,
    webSearch: DYNAMIC_SEARCH,
    toolChanges: true,
    refusalFallback: "default",
    cost: cost(4, 20, 0.2),
  },
  "claude-opus-5": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: true,
    webSearch: DYNAMIC_SEARCH,
    toolChanges: true,
    refusalFallback: "default",
    cost: cost(5, 25, 0.5),
  },
  "claude-sonnet-5-5": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: false,
    webSearch: DYNAMIC_SEARCH,
    toolChanges: true,
    refusalFallback: "default",
    cost: cost(2, 10, 0.2),
  },
  "claude-sonnet-5": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: true,
    webSearch: DYNAMIC_SEARCH,
    midConversationSystem: false,
    toolChanges: false,
    refusalFallback: null,
    cost: cost(2, 10, 0.2),
  },
  "claude-haiku-5-5": {
    ...GEN5,
    effortDefault: "medium",
    forcedToolChoice: true,
    webSearch: BASIC_SEARCH,
    toolChanges: true,
    refusalFallback: null,
    cost: cost(0.1, 0.5, 0.01),
  },
  "claude-opus-4-8": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: true,
    webSearch: DYNAMIC_SEARCH,
    toolChanges: false,
    refusalFallback: null,
    cost: cost(5, 25, 0.5),
  },
  "claude-opus-4-7": {
    ...GEN5,
    effortDefault: "high",
    forcedToolChoice: true,
    webSearch: DYNAMIC_SEARCH,
    midConversationSystem: false,
    toolChanges: false,
    refusalFallback: null,
    cost: cost(5, 25, 0.5),
  },
  "claude-opus-4-6": {
    ...GEN5,
    effortDefault: "high",
    sampling: CLAUDE_SAMPLING,
    forcedToolChoice: true,
    webSearch: DYNAMIC_SEARCH,
    midConversationSystem: false,
    toolChanges: false,
    refusalFallback: null,
    cost: cost(5, 25, 0.5),
  },
  "claude-sonnet-4-6": {
    ...GEN5,
    effortDefault: "high",
    sampling: CLAUDE_SAMPLING,
    forcedToolChoice: true,
    webSearch: DYNAMIC_SEARCH,
    midConversationSystem: false,
    toolChanges: false,
    refusalFallback: null,
    cost: cost(3, 15, 0.3),
  },
  "claude-haiku-4-5": {
    effortDefault: null,
    sampling: CLAUDE_SAMPLING,
    prefill: true,
    forcedToolChoice: true,
    webSearch: BASIC_SEARCH,
    midConversationSystem: false,
    toolChanges: false,
    refusalFallback: null,
    contextWindow: 200_000,
    maxOutput: 64_000,
    cost: cost(1, 5, 0.1),
  },
};

/** The Claude models whose capabilities are pinned, by exact id (no date suffix). */
export const KNOWN_ANTHROPIC_MODELS: ReadonlySet<string> = new Set(Object.keys(CLAUDE));

/** A model with no catalog entry and no pinned row: a small local model, as far as anyone knows. */
const UNKNOWN_CONTEXT = 32_768;
const UNKNOWN_OUTPUT = 8_192;

function pinnedClaude(modelId: string): Capabilities | null {
  const row = CLAUDE[modelId];
  if (!row) return null;
  return {
    vision: true,
    pdf: true,
    audio: false,
    video: false,
    tools: true,
    reasoning: true,
    effort: { levels: effortLevels("anthropic", modelId), default: row.effortDefault },
    thinkingDisplay: "summarized",
    sampling: row.sampling,
    prefill: row.prefill,
    forcedToolChoice: row.forcedToolChoice,
    webSearch: row.webSearch,
    midConversationSystem: row.midConversationSystem,
    toolChanges: row.toolChanges,
    refusalFallback: row.refusalFallback,
    contextWindow: row.contextWindow,
    maxOutput: row.maxOutput,
    cost: row.cost,
  };
}

/** Sampling parameters each API documents for a model. */
function catalogSampling(kind: string, reasoning: boolean): readonly SamplingParam[] {
  switch (kind) {
    case "anthropic":
      // An undocumented Claude model may be one that refuses every non-default value.
      return [];
    case "openai":
      // OpenAI's reasoning models refuse sampling parameters.
      return reasoning ? [] : ["temperature", "topP", "presencePenalty", "frequencyPenalty"];
    case "google":
      return ["temperature", "topP", "topK", "seed"];
    case "mistral":
      return ["temperature", "topP", "seed"];
    case "openai-compatible":
      return ["temperature", "topP"];
    default:
      return [];
  }
}

/** The provider's native web search where it is documented for the model family. */
function catalogWebSearch(kind: string, modelId: string, tools: boolean): WebSearchVariant | null {
  if (!tools) return null;
  const key = modelKey(modelId);
  if (kind === "openai" && /^(gpt-4-1|gpt-4o|gpt-5|gpt-6|o3|o4)/.test(key))
    return "openai:web_search";
  if (kind === "google" && /^gemini-([2-9]|\d{2})/.test(key)) return "google:google_search";
  return null;
}

/**
 * The media each protocol's SDK puts in a chat message, besides images and PDFs. Anthropic,
 * Mistral and OpenAI's Responses API refuse audio and video parts (Mistral and OpenAI hear
 * through their transcription models instead); Gemini takes both; an OpenAI-compatible server
 * gets audio as `input_audio` and video as `video_url` (`callProblem` narrows that per SDK).
 */
const MESSAGE_MEDIA: Record<string, { audio: boolean; video: boolean }> = {
  google: { audio: true, video: true },
  "openai-compatible": { audio: true, video: true },
};

function fromCatalog(
  kind: string,
  modelId: string,
  catalog: CatalogModelInfo | undefined,
): Capabilities {
  const input = (catalog?.input ?? []).map(normalizeModality);
  const media = MESSAGE_MEDIA[kind] ?? { audio: false, video: false };
  const documented = effortLevels(kind, modelId);
  // A catalog that says the model does not reason wins over a table match; otherwise the
  // makers' table is evidence that it does.
  const levels = catalog?.reasoning === false ? [] : documented;
  const reasoning = catalog?.reasoning ?? levels.length > 0;
  const tools = catalog?.toolCall ?? catalog?.tool_call ?? false;
  const contextWindow = catalog?.contextWindow ?? UNKNOWN_CONTEXT;
  const maxOutput = Math.min(catalog?.maxOutput ?? UNKNOWN_OUTPUT, contextWindow);
  const summarized = kind === "anthropic" || kind === "openai" || kind === "google";
  return {
    vision: input.includes("image"),
    pdf: input.includes("pdf"),
    audio: media.audio && input.includes("audio"),
    video: media.video && input.includes("video"),
    tools,
    reasoning,
    effort: {
      levels,
      default: kind === "openai" && levels.includes("medium") ? "medium" : null,
    },
    thinkingDisplay: reasoning ? (summarized ? "summarized" : "raw") : null,
    sampling: catalogSampling(kind, reasoning),
    prefill: false,
    forcedToolChoice: kind === "openai" || kind === "google" || kind === "mistral" ? tools : false,
    webSearch: catalogWebSearch(kind, modelId, tools),
    midConversationSystem: false,
    toolChanges: false,
    refusalFallback: null,
    contextWindow,
    maxOutput,
    cost: catalog?.cost ?? null,
  };
}

export interface ResolveCapabilitiesInput {
  /** The protocol (see `providerKindOf`). */
  kind: string;
  modelId: string;
  /** The catalog's entry for the model, e.g. a `SlimModel`. */
  catalog?: CatalogModelInfo;
  /** A user's corrections, applied last. */
  override?: CapabilityOverride;
}

/**
 * A model's capabilities: the pinned table for a known Claude model (it wins over the catalog),
 * else the catalog entry with conservative defaults for what it does not say (no sampling
 * restriction assumed lifted, no prefill, no forced tool choice unless documented, no
 * mid-conversation system message), then `override`.
 */
export function resolveCapabilities(input: ResolveCapabilitiesInput): Capabilities {
  const base =
    (input.kind === "anthropic" ? pinnedClaude(input.modelId) : null) ??
    fromCatalog(input.kind, input.modelId, input.catalog);
  return input.override ? { ...base, ...input.override } : base;
}
