import type { ModelsDevResponse, UnifiedModel } from "../types";
import { fetchUnifiedData } from "./normalize";

export type ResolveMatchedBy = "endpoint" | "provider" | "global";

export interface ResolveOptions {
  /** Base URL of the endpoint actually being called, e.g. https://api.z.ai/api/anthropic */
  endpoint?: string;
  /** Provider id to scope the lookup to, e.g. "deepseek" */
  provider?: string;
}

export interface ResolveResult {
  model: UnifiedModel;
  matchedBy: ResolveMatchedBy;
  /** models.dev provider ids the endpoint mapped to, best first. Empty unless matchedBy is "endpoint". */
  endpointProviders: string[];
}

function lastSegment(id: string): string {
  const index = id.lastIndexOf("/");
  return index > -1 ? id.slice(index + 1) : id;
}

function slashCount(id: string): number {
  let count = 0;
  for (const char of id) if (char === "/") count++;
  return count;
}

/**
 * How well a model id answers to `wanted`. Lower is better; null means no match
 * at all. Exact ids beat exact trailing segments, which beat case-insensitive
 * matches, which beat substring matches.
 */
function matchRank(id: string, wanted: string): number | null {
  const lowerId = id.toLowerCase();
  const lowerWanted = wanted.toLowerCase();

  if (id === wanted) return 0;
  if (lastSegment(id) === wanted) return 1;
  if (lowerId === lowerWanted) return 2;
  if (lastSegment(lowerId) === lowerWanted) return 3;
  if (lowerId.endsWith(`/${lowerWanted}`)) return 4;
  if (lowerId.includes(lowerWanted)) return 5;
  return null;
}

/**
 * Pick the single best model for `wanted` out of `pool`. Ties break towards the
 * shortest, least-nested id so canonical entries ("deepseek/deepseek-chat")
 * win over reseller ones ("orcarouter/deepseek/deepseek-chat").
 */
export function pickBestModel(pool: UnifiedModel[], wanted: string): UnifiedModel | null {
  let best: UnifiedModel | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const model of pool) {
    const rank = matchRank(model.id, wanted);
    if (rank === null) continue;
    if (best === null || rank < bestRank) {
      best = model;
      bestRank = rank;
      continue;
    }
    if (rank > bestRank) continue;

    const a = model.id;
    const b = best.id;
    if (slashCount(a) !== slashCount(b)) {
      if (slashCount(a) < slashCount(b)) best = model;
      continue;
    }
    if (a.length !== b.length) {
      if (a.length < b.length) best = model;
      continue;
    }
    if (a < b) best = model;
  }

  return best;
}

function parseUrl(value: string): URL | null {
  const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? [value] : [`https://${value}`];
  for (const candidate of candidates) {
    try {
      return new URL(candidate);
    } catch {
      // fall through
    }
  }
  return null;
}

function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function sharedPrefixLength(a: string[], b: string[]): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared;
}

/**
 * models.dev provider ids whose documented `api` URL lives on the same host as
 * `endpoint`, best first. Providers whose api path shares a longer prefix with
 * the endpoint path rank higher, so a coding-plan endpoint beats the generic one.
 */
export function providersForEndpoint(endpoint: string, data: ModelsDevResponse): string[] {
  const url = parseUrl(endpoint);
  if (!url) return [];

  const host = normalizeHost(url.hostname);
  const wantedPath = pathSegments(url.pathname);

  const scored: Array<{ id: string; shared: number }> = [];
  for (const [id, provider] of Object.entries(data)) {
    if (!provider.api) continue;
    const providerUrl = parseUrl(provider.api);
    if (!providerUrl || normalizeHost(providerUrl.hostname) !== host) continue;
    scored.push({ id, shared: sharedPrefixLength(wantedPath, pathSegments(providerUrl.pathname)) });
  }

  return scored
    .sort((a, b) => b.shared - a.shared || a.id.length - b.id.length || (a.id < b.id ? -1 : 1))
    .map((entry) => entry.id);
}

/**
 * Find the model a caller actually reaches, given the endpoint it talks to.
 *
 * The same model id is published under dozens of reseller providers with
 * different limits, so scoping by endpoint (or provider) is what makes the
 * answer trustworthy. Returns null when nothing matches.
 */
export async function resolveModel(
  modelId: string,
  options: ResolveOptions = {},
): Promise<ResolveResult | null> {
  const { models, modelsDevData } = await fetchUnifiedData();

  if (options.endpoint) {
    const providers = providersForEndpoint(options.endpoint, modelsDevData);
    for (const providerId of providers) {
      const pool = models.filter((m) => m.provider === providerId);
      const model = pickBestModel(pool, modelId);
      if (model) return { model, matchedBy: "endpoint", endpointProviders: providers };
    }
  }

  if (options.provider) {
    const wanted = options.provider.toLowerCase();
    const pool = models.filter((m) => m.provider.toLowerCase() === wanted);
    const model = pickBestModel(pool, modelId);
    if (model) return { model, matchedBy: "provider", endpointProviders: [] };
  }

  const model = pickBestModel(models, modelId);
  return model ? { model, matchedBy: "global", endpointProviders: [] } : null;
}
