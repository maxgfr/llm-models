// What a call to `streamText` / `generateText` should carry for the model the
// settings point to, and what it must not: the provider options of each
// protocol (effort, readable reasoning, stateless OpenAI), a check made before
// any network call, and the stop reason read back from the provider.

import type { JSONValue, ModelMessage } from "ai";
import {
  type Capabilities,
  resolveCapabilities,
  SAMPLING_PARAMS,
  type SamplingParam,
} from "./capabilities.js";
import { type Effort, effortWire } from "./effort.js";
import { baseUrlOf, isAnthropicHost, modelIdOf, providerKindOf } from "./provider-kind.js";
import { resolveAlias } from "./registry.js";
import type { LlmSettings } from "./settings.js";

/** The audio an OpenAI-compatible message carries (`input_audio`): WAV or MP3, inline. */
const MESSAGE_AUDIO = new Set(["audio/wav", "audio/mp3", "audio/mpeg"]);

/**
 * An OpenAI-compatible protocol called through the OpenAI SDK's Chat Completions (a custom
 * endpoint, or the OpenAI package on another URL), which sends no video, rather than through
 * `@ai-sdk/openai-compatible`.
 */
function viaOpenAIChat(settings: LlmSettings): boolean {
  return (
    providerKindOf(settings) === "openai-compatible" &&
    (!!settings.customEndpoint || resolveAlias(settings.providerNpm || "openai") === "openai")
  );
}

/** Sampling values a call may set, in the AI SDK's names. */
export type Sampling = { [K in SamplingParam]?: number };

export interface CallOptionsInput {
  /** The effort to send; nothing is sent when null or missing. Must be one the model takes. */
  effort?: Effort | null;
  /** Sampling values the call sets; they are returned as given. */
  sampling?: Sampling;
  /** The output cap; adjusted so an Anthropic thinking budget stays within the model's limit. */
  maxOutputTokens?: number;
  /**
   * Opt in to Anthropic's server-side refusal fallback (`fallbacks: "default"`) when the model
   * has one and the settings call Anthropic's own API. Another model may then serve the turn.
   */
  refusalFallback?: boolean;
  /** The model's capabilities; resolved from the settings when missing. */
  capabilities?: Capabilities;
}

/** Options to spread into `streamText` or `generateText`. */
export interface CallOptions extends Sampling {
  providerOptions: Record<string, Record<string, JSONValue>>;
  maxOutputTokens?: number;
}

/** Why a call cannot be made as asked. */
export type CallProblemCode =
  | "effort"
  | "sampling"
  | "budget-sampling"
  | "prefill"
  | "system-message"
  | "tools"
  | "tool-choice"
  | "web-search"
  | "max-output"
  | "vision"
  | "pdf"
  | "audio"
  | "video"
  | "no-messages";

export interface CallProblem {
  code: CallProblemCode;
  message: string;
}

/** Thrown by {@link callOptions} for an effort the model does not take. */
export class LlmCallError extends Error {
  readonly code: CallProblemCode;
  constructor(problem: CallProblem) {
    super(problem.message);
    this.name = "LlmCallError";
    this.code = problem.code;
  }
}

function capabilitiesOf(settings: LlmSettings, capabilities?: Capabilities): Capabilities {
  return (
    capabilities ??
    resolveCapabilities({ kind: providerKindOf(settings), modelId: modelIdOf(settings) })
  );
}

function hasSampling(sampling: Sampling | undefined): boolean {
  return SAMPLING_PARAMS.some((key) => sampling?.[key] !== undefined);
}

/**
 * The provider options of a call, as each protocol takes them:
 *
 * - Anthropic: effort as `output_config.effort` with adaptive thinking in its summarized form
 *   (left out when the call sets a sampling parameter, which thinking refuses), or a thinking
 *   budget on the models before Claude 4.6, with the output cap lowered to make room for it.
 * - OpenAI (Responses API, official URL): `store: false`, so OpenAI keeps no conversation state;
 *   on a reasoning model, the encrypted reasoning comes back for replay and a summary is asked for.
 * - Gemini: thought summaries on a reasoning model, and a thinking level (Gemini 3) or budget (2.5).
 * - Mistral and OpenAI-compatible servers: nothing, since a server may refuse what it does not know.
 *
 * Replaying a conversation needs nothing more: pass back the `response.messages` of each turn,
 * whose reasoning parts carry their signatures and encrypted content unchanged.
 *
 * Throws {@link LlmCallError} for an effort the model does not take.
 */
export function callOptions(settings: LlmSettings, input: CallOptionsInput = {}): CallOptions {
  const kind = providerKindOf(settings);
  const modelId = modelIdOf(settings);
  const caps = capabilitiesOf(settings, input.capabilities);
  const effort = input.effort ?? null;
  const wire = effort === null ? null : effortWire(kind, modelId, effort);
  if (effort !== null && (wire === null || !caps.effort.levels.includes(effort)))
    throw new LlmCallError({
      code: "effort",
      message: `The model does not take the effort ${effort}`,
    });
  const sampling: Sampling = {};
  for (const key of SAMPLING_PARAMS)
    if (input.sampling?.[key] !== undefined) sampling[key] = input.sampling[key];
  let maxOutputTokens = input.maxOutputTokens;
  const out = (providerOptions: CallOptions["providerOptions"]): CallOptions => ({
    ...sampling,
    providerOptions,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });

  switch (kind) {
    case "anthropic": {
      const options: Record<string, JSONValue> = {};
      const first = caps.effort.levels[0];
      const mode = first === undefined ? null : effortWire(kind, modelId, first)?.param;
      if (wire?.param === "thinking.budget_tokens") {
        options.thinking = { type: "enabled", budgetTokens: wire.value };
        // The SDK adds the budget to max_tokens; the sum must stay within the model's limit.
        maxOutputTokens = Math.max(
          1,
          Math.min(maxOutputTokens ?? caps.maxOutput, caps.maxOutput - wire.value),
        );
      } else if (mode === "output_config.effort") {
        if (!hasSampling(sampling)) options.thinking = { type: "adaptive", display: "summarized" };
        if (wire?.param === "output_config.effort") options.effort = wire.value;
      }
      if (
        input.refusalFallback &&
        caps.refusalFallback === "default" &&
        isAnthropicHost(baseUrlOf(settings))
      )
        options.fallbacks = "default";
      return out({ anthropic: options });
    }
    case "openai": {
      const options: Record<string, JSONValue> = { store: false };
      if (caps.reasoning) {
        options.include = ["reasoning.encrypted_content"];
        options.reasoningSummary = "auto";
      }
      if (wire?.param === "reasoning.effort") options.reasoningEffort = wire.value;
      return out({ openai: options });
    }
    case "google": {
      const thinkingConfig: Record<string, JSONValue> = {};
      if (caps.reasoning) thinkingConfig.includeThoughts = true;
      if (wire?.param === "thinkingConfig.thinkingLevel") thinkingConfig.thinkingLevel = wire.value;
      if (wire?.param === "thinkingConfig.thinkingBudget")
        thinkingConfig.thinkingBudget = wire.value;
      return out(Object.keys(thinkingConfig).length > 0 ? { google: { thinkingConfig } } : {});
    }
    default:
      return out({});
  }
}

/** What {@link callProblem} checks: the parts of a `streamText` call a model may refuse. */
export interface CallCheck extends Sampling {
  effort?: Effort | null;
  messages?: readonly ModelMessage[];
  /** The function tools declared (a `ToolSet`, or their names). */
  tools?: Readonly<Record<string, unknown>> | readonly string[];
  toolChoice?: "auto" | "none" | "required" | { type: "tool"; toolName: string };
  maxOutputTokens?: number;
  /** The provider's web search is declared. */
  webSearch?: boolean;
}

function problem(code: CallProblemCode, message: string): CallProblem {
  return { code, message };
}

function partsOf(message: ModelMessage): readonly { type: string; mediaType?: string }[] {
  return Array.isArray(message.content)
    ? (message.content as { type: string; mediaType?: string }[])
    : [];
}

/**
 * What the model would refuse in a call, or null when it can be made: an effort it does not take,
 * a sampling parameter it refuses (or one next to a thinking budget), an assistant message last
 * (prefill), a system message after the first one, tools, a forced tool choice, web search,
 * images, PDFs, audio or video it does not take (or that its SDK cannot send), or an output cap
 * above its limit. Check before calling: a
 * parameter is never silently dropped.
 */
export function callProblem(
  settings: LlmSettings,
  call: CallCheck,
  capabilities?: Capabilities,
): CallProblem | null {
  const kind = providerKindOf(settings);
  const modelId = modelIdOf(settings);
  const caps = capabilitiesOf(settings, capabilities);
  const messages = call.messages;
  if (messages && messages.length === 0) return problem("no-messages", "A call needs a message");
  const last = messages?.[messages.length - 1];
  if (last?.role === "assistant" && !caps.prefill)
    return problem("prefill", "The model does not continue an assistant message (prefill)");
  for (const key of SAMPLING_PARAMS) {
    const value = call[key];
    if (value === undefined) continue;
    if (!caps.sampling.includes(key)) return problem("sampling", `The model does not take ${key}`);
    if (!Number.isFinite(value)) return problem("sampling", `${key} must be a finite number`);
  }
  const effort = call.effort ?? null;
  if (effort !== null) {
    const wire = effortWire(kind, modelId, effort);
    if (wire === null || !caps.effort.levels.includes(effort))
      return problem("effort", `The model does not take the effort ${effort}`);
    // A thinking budget is the only way such a model takes effort, and thinking refuses sampling.
    if (wire.param === "thinking.budget_tokens" && hasSampling(call))
      return problem(
        "budget-sampling",
        "A thinking budget cannot be combined with sampling parameters",
      );
  }
  const tools = call.tools
    ? Array.isArray(call.tools)
      ? call.tools
      : Object.keys(call.tools)
    : [];
  if (tools.length > 0 && !caps.tools) return problem("tools", "The model does not take tools");
  const choice = call.toolChoice;
  if ((choice === "required" || typeof choice === "object") && !caps.forcedToolChoice)
    return problem("tool-choice", "The model does not accept a forced tool choice");
  if (call.webSearch) {
    if (caps.webSearch === null) return problem("web-search", "The model has no web search");
    // Gemini before 3 drops function tools declared next to Google Search.
    if (
      kind === "google" &&
      tools.some((name) => name !== "web_search") &&
      /^gemini-[12]([.-]|$)/.test(modelId)
    )
      return problem(
        "web-search",
        "This Gemini model cannot combine web search with function tools",
      );
  }
  if (call.maxOutputTokens !== undefined) {
    const n = call.maxOutputTokens;
    if (!Number.isSafeInteger(n) || n < 1 || n > caps.maxOutput)
      return problem("max-output", "maxOutputTokens is out of range");
  }
  for (const [i, message] of (messages ?? []).entries()) {
    if (message.role === "system" && i > 0 && !caps.midConversationSystem)
      return problem("system-message", "The model does not take mid-conversation system messages");
    for (const part of partsOf(message)) {
      const media = part.mediaType ?? "";
      if ((part.type === "image" || media.startsWith("image/")) && !caps.vision)
        return problem("vision", "The model does not take images");
      if (part.type === "file" && media === "application/pdf" && !caps.pdf)
        return problem("pdf", "The model does not take PDFs");
      if (part.type === "file" && media.startsWith("audio")) {
        if (!caps.audio) return problem("audio", "The model does not take audio");
        if (kind === "openai-compatible" && !MESSAGE_AUDIO.has(media))
          return problem("audio", "This API takes audio as WAV or MP3 only");
      }
      if (part.type === "file" && media.startsWith("video")) {
        if (!caps.video) return problem("video", "The model does not take video");
        if (viaOpenAIChat(settings))
          return problem("video", "Chat Completions through the OpenAI SDK sends no video");
      }
    }
  }
  return null;
}

/**
 * Why a response ended. `refusal` is Anthropic's `stop_reason: "refusal"` (read its details with
 * {@link refusalOf}); `content-filter` another provider's filter; `pause` Anthropic's `pause_turn`;
 * `truncated` a stream that closed before the provider's own finish event.
 */
export type StopReason =
  | "end"
  | "length"
  | "tool-calls"
  | "stop-sequence"
  | "refusal"
  | "content-filter"
  | "pause"
  | "truncated"
  | "other";

/**
 * The stop reason of a step or a response, from the AI SDK's `finishReason` and
 * `rawFinishReason`. Every SDK package starts from `other` with no raw reason and replaces it on
 * the provider's finish event, so that pair means the stream was cut.
 */
export function stopReasonOf(
  kind: string,
  finishReason: string,
  rawFinishReason?: string,
): StopReason {
  if (kind === "anthropic" && rawFinishReason === "refusal") return "refusal";
  if (rawFinishReason === "pause_turn") return "pause";
  switch (finishReason) {
    case "stop":
      return rawFinishReason === "stop_sequence" ? "stop-sequence" : "end";
    case "length":
      return "length";
    case "tool-calls":
      return "tool-calls";
    case "content-filter":
      return "content-filter";
    case "other":
      return rawFinishReason === undefined ? "truncated" : "other";
    default:
      return "other";
  }
}

/**
 * Anthropic's details of a refusal (`stop_details`), from a step's `providerMetadata`, or null
 * when there are none. A null `category` is a valid value.
 */
export function refusalOf(
  providerMetadata: unknown,
): { category: string | null; explanation?: string } | null {
  const anthropic = (providerMetadata as { anthropic?: { stopDetails?: unknown } } | undefined)
    ?.anthropic;
  const details = anthropic?.stopDetails as
    | { category?: unknown; explanation?: unknown }
    | null
    | undefined;
  if (typeof details !== "object" || details === null) return null;
  const category = typeof details.category === "string" ? details.category : null;
  return typeof details.explanation === "string"
    ? { category, explanation: details.explanation }
    : { category };
}
