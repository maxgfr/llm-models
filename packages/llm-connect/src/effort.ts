// The reasoning-effort scale and how each provider's API takes it. The tables
// follow the makers' own documentation; a model nobody documented takes no
// effort, because a guess risks a request the API refuses.

/** How much a reasoning model thinks before it answers, weakest first. */
export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Where a level goes in the provider's request, and as what. */
export type EffortWire =
  /** Anthropic Messages, Claude 4.6 and later: `output_config.effort`, with adaptive thinking. */
  | { param: "output_config.effort"; value: "low" | "medium" | "high" | "xhigh" | "max" }
  /** Anthropic models before Claude 4.6: a thinking budget (`thinking.budget_tokens`). */
  | { param: "thinking.budget_tokens"; value: number }
  /** OpenAI Responses: `reasoning.effort`. */
  | {
      param: "reasoning.effort";
      value: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    }
  /** Gemini 3: `generationConfig.thinkingConfig.thinkingLevel`. */
  | { param: "thinkingConfig.thinkingLevel"; value: "minimal" | "low" | "medium" | "high" }
  /** Gemini 2.5: `generationConfig.thinkingConfig.thinkingBudget`. */
  | { param: "thinkingConfig.thinkingBudget"; value: number };

/** Every level, weakest first. */
export const EFFORTS: readonly Effort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const LMH: readonly Effort[] = ["low", "medium", "high"];
const LMHX: readonly Effort[] = ["low", "medium", "high", "xhigh"];
const LMHXM: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * A model id as the tables match it: lower case, `.` folded to `-`, any `:variant` and any date
 * suffix dropped, so `claude-sonnet-4-6-20260115`, `gemini-2.5-flash` and `gpt-5.1:nitro` resolve
 * like their bare names.
 */
export function modelKey(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/:.*$/, "")
    .replace(/\./g, "-")
    .replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, "");
}

type Table = readonly (readonly [RegExp, readonly Effort[]])[];

/**
 * What each maker's API accepts, by model key; the first match wins. Anthropic:
 * `output_config.effort` from Claude 4.6 on (`xhigh` from 4.7), a thinking budget before. OpenAI:
 * `reasoning.effort`, which has no `max`. Gemini: `thinkingLevel` on Gemini 3, a thinking budget
 * on 2.5.
 */
const LEVELS: Readonly<Record<"anthropic" | "openai" | "google", Table>> = {
  anthropic: [
    [
      /^claude-(fable|mythos)-5(-1)?$|^claude-mythos-preview$|^claude-(opus|sonnet)-5(-5)?$|^claude-haiku-5-5$/,
      LMHXM,
    ],
    [/^claude-opus-4-[78]$/, LMHXM],
    [/^claude-(opus|sonnet)-4-6$/, ["low", "medium", "high", "max"]],
    [/^claude-(opus|sonnet|haiku)-4-5$|^claude-opus-4-1$|^claude-(opus|sonnet)-4$/, LMH],
  ],
  openai: [
    [/^gpt-6-(sol|luna)$|^gpt-5-6(-(sol|luna|terra))?$/, ["none", ...LMHX]],
    [/^gpt-6(-\d+)?-(sol|luna|astra)$/, LMHX],
    [/^gpt-5-[2-5]-pro$/, ["medium", "high", "xhigh"]],
    [/^gpt-5-[2-5](-mini|-nano)?$/, ["none", ...LMHX]],
    [/^gpt-5-[2-9]-codex$|^gpt-5-1-codex-max$/, LMHX],
    [/^gpt-5(-1)?-codex(-mini)?$/, LMH],
    [/^gpt-5-1$/, ["none", ...LMH]],
    [/^gpt-5(-mini|-nano)?$/, ["minimal", ...LMH]],
    [/^(o1|o3|o3-mini|o3-pro|o4-mini)$/, LMH],
  ],
  google: [
    [/^gemini-4-argon$/, LMH],
    [/^gemini-3-pro(-preview)?$/, ["low", "high"]],
    [/^gemini-3-1-pro(-preview)?(-customtools)?$/, LMH],
    [/^gemini-3-[7-9]-flash(-preview)?$/, LMH],
    [/^gemini-3(-[1-6])?-flash(-lite)?(-preview)?$/, ["minimal", ...LMH]],
    [/^gemini-2-5-(pro|flash|flash-lite)$/, LMH],
  ],
};

/** Thinking budgets in tokens for the Anthropic models that take one (at least 1024). */
const ANTHROPIC_BUDGET: Readonly<Partial<Record<Effort, number>>> = {
  low: 2048,
  medium: 8192,
  high: 24_576,
};
/** Gemini 2.5 thinking budgets in tokens (Flash accepts up to 24576, Pro up to 32768). */
const GEMINI_BUDGET: Readonly<Partial<Record<Effort, number>>> = {
  low: 1024,
  medium: 8192,
  high: 24_576,
};

/** Whether an Anthropic model takes effort as a thinking budget (the models before Claude 4.6). */
function anthropicBudgeted(modelId: string): boolean {
  return /^claude-(opus|sonnet|haiku)-4-5$|^claude-opus-4-1$|^claude-(opus|sonnet)-4$/.test(
    modelKey(modelId),
  );
}

/** Whether a Gemini model takes a thinking budget rather than a level (Gemini 2.5). */
function geminiBudgeted(modelId: string): boolean {
  return /^gemini-2-5-/.test(modelKey(modelId));
}

/**
 * The levels a model takes through a provider kind (see `providerKindOf`), weakest first; empty
 * for a model not known to take any, and for every OpenAI-compatible server or Mistral, which
 * may refuse a parameter it does not know.
 */
export function effortLevels(kind: string, modelId: string): readonly Effort[] {
  if (kind !== "anthropic" && kind !== "openai" && kind !== "google") return [];
  const key = modelKey(modelId);
  return LEVELS[kind].find(([re]) => re.test(key))?.[1] ?? [];
}

/** How `effort` is sent to that model, or null when it takes none or not that level. */
export function effortWire(kind: string, modelId: string, effort: Effort): EffortWire | null {
  if (!effortLevels(kind, modelId).includes(effort)) return null;
  switch (kind) {
    case "anthropic": {
      if (anthropicBudgeted(modelId)) {
        const value = ANTHROPIC_BUDGET[effort];
        return value === undefined ? null : { param: "thinking.budget_tokens", value };
      }
      if (effort === "none" || effort === "minimal") return null;
      return { param: "output_config.effort", value: effort };
    }
    case "openai":
      if (effort === "max") return null;
      return { param: "reasoning.effort", value: effort };
    case "google": {
      if (geminiBudgeted(modelId)) {
        const value = GEMINI_BUDGET[effort];
        return value === undefined ? null : { param: "thinkingConfig.thinkingBudget", value };
      }
      if (effort === "minimal" || effort === "low" || effort === "medium" || effort === "high")
        return { param: "thinkingConfig.thinkingLevel", value: effort };
      return null;
    }
    default:
      return null;
  }
}

/** `effort` when `levels` include it, else null (nothing is sent and the model's default applies). */
export function usableEffort(
  effort: Effort | null | undefined,
  levels: readonly Effort[],
): Effort | null {
  return effort !== null && effort !== undefined && levels.includes(effort) ? effort : null;
}
