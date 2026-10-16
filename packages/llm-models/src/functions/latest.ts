import type { UnifiedModel } from "../types";
import { fetchUnifiedData } from "./normalize";
import { providersForEndpoint } from "./resolve";

export type Tier = "opus" | "sonnet" | "haiku";

export const TIERS: readonly Tier[] = ["opus", "sonnet", "haiku"];

export interface LatestOptions {
  /** Base URL of the endpoint actually being called, e.g. https://api.z.ai/api/anthropic */
  endpoint?: string;
  /** Provider id to scope the pick to, e.g. "deepseek" */
  provider?: string;
  /** Keep only ids containing this token, or families starting with it (e.g. "anthropic/") */
  filter?: string;
}

export interface LatestPick {
  tier: Tier;
  model: UnifiedModel;
}

export interface LatestResult {
  picks: LatestPick[];
  /** The provider the picks were taken from */
  provider: string;
  /** models.dev provider ids the endpoint mapped to, best first. Empty when scoped by --provider. */
  endpointProviders: string[];
}

/**
 * Variant suffixes that mark a model as the fast / cheap sibling of its
 * generation rather than the flagship. Matched on whole tokens: "mini" as a
 * substring would classify every MiniMax model as fast.
 */
const FAST_TOKENS = new Set([
  "flash",
  "flashx",
  "highspeed",
  "turbo",
  "lite",
  "mini",
  "air",
  "nano",
  "fast",
  "haiku",
]);

/**
 * Tokens that mark a model as something other than a general-purpose chat
 * model a coding agent can drive: experimental or preview drops, vision-only
 * or speech variants, embeddings, distillations, roleplay tunes.
 */
const EXCLUDED_TOKENS = new Set([
  "exp",
  "preview",
  "vision",
  "vl",
  "character",
  "her",
  "realtime",
  "omni",
  "asr",
  "tts",
  "embed",
  "embedding",
  "distill",
  "livetranslate",
]);

function lastSegment(id: string): string {
  const index = id.lastIndexOf("/");
  return index > -1 ? id.slice(index + 1) : id;
}

/** Lower-cased tokens of the id's last path segment, split on -, _, . and :. */
function tokens(id: string): string[] {
  return lastSegment(id)
    .toLowerCase()
    .split(/[-_.:]/)
    .filter((token) => token.length > 0);
}

/**
 * First dotted number in the id's last segment as a numeric tuple:
 * "glm-5.3-flash" -> [5, 3], "kimi-k2.7-code" -> [2, 7], "deepseek-chat" -> [0].
 */
export function version(id: string): number[] {
  const match = /\d+(\.\d+)*/.exec(lastSegment(id));
  if (!match) return [0];
  return match[0].split(".").map((part) => Number.parseInt(part, 10));
}

function major(id: string): number {
  return version(id)[0] ?? 0;
}

export function isFast(model: UnifiedModel): boolean {
  return tokens(model.id).some((token) => FAST_TOKENS.has(token));
}

/**
 * Whether a model is a candidate at all: a current, tool-calling, text-producing
 * chat model reachable under a stable id. Batch or free routes (":batch",
 * ":free") and OpenRouter's moving "~vendor/…" aliases are not stable ids.
 */
export function isEligible(model: UnifiedModel): boolean {
  if (model.id.includes(":")) return false;
  if (model.id.split("/").some((segment) => segment.startsWith("~"))) return false;
  if (model.status === "deprecated") return false;
  if (model.capabilities.tool_call !== true) return false;
  if (!model.modalities.output.includes("text")) return false;
  return !tokens(model.id).some((token) => EXCLUDED_TOKENS.has(token));
}

function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Newest first: dated entries before undated ones, then by release date, then
 * by the version number in the id, then the shortest id, then alphabetical —
 * so "deepseek-v4-pro" (dated) beats "deepseek-v4-pro-0813" (undated), and two
 * builds of the same day still sort the same way on every run.
 */
export function compareRecency(a: UnifiedModel, b: UnifiedModel): number {
  const aDate = a.release_date ?? "";
  const bDate = b.release_date ?? "";
  if ((aDate === "") !== (bDate === "")) return aDate === "" ? 1 : -1;
  if (aDate !== bDate) return aDate < bDate ? 1 : -1;

  const byVersion = compareVersions(version(b.id), version(a.id));
  if (byVersion !== 0) return byVersion;

  if (a.id.length !== b.id.length) return a.id.length - b.id.length;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function matchesFilter(model: UnifiedModel, filter: string): boolean {
  const wanted = filter.toLowerCase();
  if (model.id.toLowerCase().includes(wanted)) return true;
  return model.family?.toLowerCase().startsWith(wanted) ?? false;
}

function newestWithPrefix(sorted: UnifiedModel[], prefix: string): UnifiedModel | undefined {
  return sorted.find((model) => lastSegment(model.id).toLowerCase().startsWith(prefix));
}

/**
 * Anthropic names its tiers, so when the pool is Claude models the tiers map
 * literally: the newest claude-opus*, claude-sonnet* and claude-haiku*. A tier
 * with no entry falls back to the previous one.
 */
function pickClaudeTiers(sorted: UnifiedModel[]): LatestPick[] {
  const opus = newestWithPrefix(sorted, "claude-opus") ?? sorted[0];
  const sonnet = newestWithPrefix(sorted, "claude-sonnet") ?? opus;
  const haiku = newestWithPrefix(sorted, "claude-haiku") ?? sonnet;
  return [
    { tier: "opus", model: opus },
    { tier: "sonnet", model: sonnet },
    { tier: "haiku", model: haiku },
  ];
}

/**
 * Pick the newest flagship (opus) and its fast sibling (sonnet and haiku) out
 * of `pool`. The fast pick has to share the flagship's major version, so a
 * "glm-4.7-flash" never pairs with "glm-5.3"; when the generation ships no fast
 * variant, every tier is the flagship. Pools that hold only fast models make
 * the newest of them the flagship. Returns null when nothing is eligible.
 */
export function pickTiers(pool: UnifiedModel[], filter?: string): LatestPick[] | null {
  const wanted = filter?.trim() ?? "";
  const candidates = pool.filter(
    (model) => isEligible(model) && (wanted === "" || matchesFilter(model, wanted)),
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort(compareRecency);

  if (sorted.some((model) => model.family?.toLowerCase().startsWith("claude-"))) {
    return pickClaudeTiers(sorted);
  }

  const opus = sorted.find((model) => !isFast(model)) ?? sorted[0];
  const generation = major(opus.id);
  const sonnet = sorted.find((model) => isFast(model) && major(model.id) === generation) ?? opus;

  return [
    { tier: "opus", model: opus },
    { tier: "sonnet", model: sonnet },
    { tier: "haiku", model: sonnet },
  ];
}

/**
 * Pick the latest models per tier for the endpoint (or provider) a caller
 * talks to. With an endpoint, the first provider on that host whose pool
 * yields a pick wins, so a coding-plan endpoint answers with its own catalogue.
 * Returns null when neither scope is given or nothing is eligible.
 */
export async function latestModels(options: LatestOptions): Promise<LatestResult | null> {
  if (!options.endpoint && !options.provider) return null;

  const { models, modelsDevData } = await fetchUnifiedData();

  if (options.endpoint) {
    const providers = providersForEndpoint(options.endpoint, modelsDevData);
    for (const providerId of providers) {
      const pool = models.filter((m) => m.provider === providerId);
      const picks = pickTiers(pool, options.filter);
      if (picks) return { picks, provider: providerId, endpointProviders: providers };
    }
  }

  if (options.provider) {
    const wanted = options.provider.toLowerCase();
    const pool = models.filter((m) => m.provider.toLowerCase() === wanted);
    const picks = pickTiers(pool, options.filter);
    if (picks)
      return { picks, provider: pool[0]?.provider ?? options.provider, endpointProviders: [] };
  }

  return null;
}
